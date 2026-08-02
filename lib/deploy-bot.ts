import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/encryption";
import { buildFreqtradeCloudInit, createHetznerServer, deleteHetznerServer } from "@/lib/hetzner";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { generateCallbackToken, hashCallbackToken } from "@/lib/training-token";
import type { FreqAIProfileConfig } from "@/lib/strategy-presets";

type BotRow = Prisma.BotConfigurationGetPayload<object>;

interface DeployBotParams {
  bot: BotRow;
  supabase: SupabaseClient;
}

// The single provisioning primitive behind two call sites with different
// policy: POST /api/deploy (first-ever deploy — checked for quota, billing,
// and BotStatus there before calling this) and the training callback's
// resume-after-retrain path (deliberately calls this WHILE status is
// UPDATING_MODEL, since resolving that status is the whole point). This
// function itself only asserts the one precondition both callers share —
// a trained model must exist — never BotStatus, so it must not be called
// directly from anywhere that hasn't already applied the right guard.
export async function deployBotToVps({ bot, supabase }: DeployBotParams) {
  if (!bot.aiModelPath) {
    throw new Error("Upload a trained .joblib model before deploying");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured");

  // The "models" bucket is private, so the Hetzner VPS (which has no
  // Supabase session) needs a short-lived signed URL to fetch the file
  // during cloud-init — long enough for boot + Docker pull + download.
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("models")
    .createSignedUrl(bot.aiModelPath, 3600);
  if (signedUrlError || !signedUrlData) {
    throw new Error(`Failed to create a download URL for the model: ${signedUrlError?.message}`);
  }

  // Randomized per (re)deploy so the freqtrade REST API never ships with
  // guessable credentials, and rotated on every redeploy for good hygiene.
  const apiServerUsername = `freqtrader-${crypto.randomBytes(4).toString("hex")}`;
  const apiServerPassword = crypto.randomBytes(24).toString("base64url");
  const apiServerJwtSecret = crypto.randomBytes(32).toString("hex");
  const statusWebhookToken = generateCallbackToken();

  const cloudInit = buildFreqtradeCloudInit({
    botName: bot.botName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    exchangeName: bot.exchangeName,
    exchangeApiKey: decrypt(bot.exchangeApiKey),
    exchangeApiSecret: decrypt(bot.exchangeApiSecret),
    strategy: bot.strategy,
    strategyCode: bot.strategyCode,
    freqaiConfig: bot.freqaiConfig as unknown as FreqAIProfileConfig,
    autoSelectCoins: bot.autoSelectCoins,
    pairWhitelist: bot.pairWhitelist ? bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean) : [],
    totalBudget: bot.totalBudget,
    maxStakePercentage: bot.maxStakePercentage,
    isPaperTrading: bot.isPaperTrading,
    aiModelDownloadUrl: signedUrlData.signedUrl,
    apiServerUsername,
    apiServerPassword,
    apiServerJwtSecret,
    statusWebhookUrl: `${appUrl}/api/bots/${bot.id}/status`,
    statusWebhookToken,
  });

  // Redeploy (retrain completed for an already-live bot): tear down the old
  // VM first so we never end up paying for two servers for one bot. Best
  // effort — if this fails, the old box is an orphan the reaper doesn't
  // currently cover (it only watches TrainingJob-linked servers), which is
  // an acceptable gap for the rare case of a mid-redeploy Hetzner failure.
  if (bot.hetznerServerId) {
    try {
      await deleteHetznerServer(bot.hetznerServerId);
    } catch {
      // continue anyway — provisioning the replacement matters more than a stalled cleanup
    }
  }

  const { server } = await createHetznerServer({
    name: `bot-${bot.id}-${Date.now()}`,
    cloudInit,
    firewallProfile: "live-trading",
  });

  const updated = await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: {
      deploymentStatus: "VPS_ACTIVE",
      status: "TRADING",
      hetznerServerId: String(server.id),
      hetznerServerIp: server.public_net?.ipv4?.ip ?? null,
      apiServerUsername,
      apiServerPassword: encrypt(apiServerPassword),
      apiServerJwtSecret: encrypt(apiServerJwtSecret),
      statusWebhookTokenHash: hashCallbackToken(statusWebhookToken),
      lastError: null,
    },
    select: botSelect,
  });

  return {
    bot: toBotDTO(updated),
    // Only ever available here and via GET /api/bots/[id]/credentials afterwards.
    apiCredentials: { username: apiServerUsername, password: apiServerPassword },
  };
}
