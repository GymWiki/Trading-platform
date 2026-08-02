import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { decrypt } from "@/lib/encryption";
import { buildFreqAITrainingCloudInit, createHetznerServer } from "@/lib/hetzner";
import { DEFAULT_PAPER_TOTAL_BUDGET, DEFAULT_PAPER_MAX_STAKE_PERCENTAGE } from "@/lib/paper-trading-defaults";
import { generateCallbackToken, hashCallbackToken } from "@/lib/training-token";
import { stopBot, forceExitAll } from "@/lib/freqtrade-client";
import type { FreqAIProfileConfig } from "@/lib/strategy-presets";

type BotRow = Prisma.BotConfigurationGetPayload<object>;

const TRAINING_SERVER_TYPE = process.env.HETZNER_TRAINING_SERVER_TYPE || "cpx31";

export class TrainingBusyError extends Error {}

interface StartCloudTrainingParams {
  bot: BotRow;
  /** Force-close open positions before pausing, instead of just halting new entries. Only meaningful if the bot is currently deployed (paper or live). */
  cancelOpenOrders?: boolean;
}

// The single place a cloud training job gets created — called directly by
// POST /api/train/cloud (user clicked "Start Cloud Training") and by
// POST /api/bots/[id]/status handling a "retrain_needed" event from a
// deployed bot. Both paths get the same priority guarantee for free: if
// the bot is currently deployed — paper or live, both actually run the
// freqtrade loop — it is genuinely paused (via its own freqtrade REST API,
// not just a database flag) before any training bookkeeping happens.
export async function startCloudTrainingJob({ bot, cancelOpenOrders = false }: StartCloudTrainingParams) {
  const activeJob = await prisma.trainingJob.findFirst({
    where: { botId: bot.id, status: { in: ["QUEUED", "TRAINING"] } },
  });
  if (activeJob) {
    throw new TrainingBusyError("A training job is already running for this bot");
  }
  if (bot.status === "TRAINING" || bot.status === "UPDATING_MODEL") {
    throw new TrainingBusyError(`Bot is already ${bot.status}`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  const hetznerApiToken = process.env.HETZNER_API_TOKEN;
  if (!hetznerApiToken) throw new Error("HETZNER_API_TOKEN is not configured");

  // Priority rule: training/updating always wins over active trading
  // (paper or live), and the pause must be real, not just a status label —
  // hence the freqtrade API call, using this bot's own per-deployment
  // credentials. deployBotToVps derives the resume status from
  // isPaperTrading, so whichever phase this was in is exactly what it
  // resumes to.
  const wasDeployed = bot.status === "TRAINING_PAPER_TRADE" || bot.status === "LIVE_TRADING";
  if (wasDeployed) {
    if (!bot.hetznerServerIp || !bot.apiServerUsername || !bot.apiServerPassword) {
      throw new Error(`Bot is ${bot.status} but has no reachable API credentials — refusing to start a retrain blind`);
    }
    const creds = {
      serverIp: bot.hetznerServerIp,
      username: bot.apiServerUsername,
      password: decrypt(bot.apiServerPassword),
    };
    await stopBot(creds);
    if (cancelOpenOrders) {
      await forceExitAll(creds);
    }
  }

  await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: { status: wasDeployed ? "UPDATING_MODEL" : "TRAINING", trainingMode: "CLOUD" },
  });

  const callbackToken = generateCallbackToken();
  const job = await prisma.trainingJob.create({
    data: {
      botId: bot.id,
      userId: bot.userId,
      mode: "CLOUD",
      status: "QUEUED",
      callbackTokenHash: hashCallbackToken(callbackToken),
    },
  });

  try {
    const cloudInit = buildFreqAITrainingCloudInit({
      botName: bot.botName,
      exchangeName: bot.exchangeName,
      strategy: bot.strategy,
      strategyCode: bot.strategyCode,
      freqaiConfig: bot.freqaiConfig as unknown as FreqAIProfileConfig,
      autoSelectCoins: bot.autoSelectCoins,
      pairWhitelist: bot.pairWhitelist ? bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean) : [],
      totalBudget: bot.totalBudget ?? DEFAULT_PAPER_TOTAL_BUDGET,
      maxStakePercentage: bot.maxStakePercentage ?? DEFAULT_PAPER_MAX_STAKE_PERCENTAGE,
      uploadUrlEndpoint: `${appUrl}/api/train/cloud/upload-url`,
      callbackUrl: `${appUrl}/api/train/cloud/callback`,
      callbackToken,
      hetznerApiToken,
    });

    const { server } = await createHetznerServer({
      name: `train-${job.id}`,
      cloudInit,
      serverType: TRAINING_SERVER_TYPE,
      firewallProfile: "training",
    });

    return await prisma.trainingJob.update({
      where: { id: job.id },
      data: { status: "TRAINING", hetznerServerId: String(server.id) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start cloud training";
    await prisma.trainingJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: message },
    });
    // Deliberately left paused rather than auto-resumed: if the bot was
    // TRADING and we already stopped it above, an unexplained provisioning
    // failure is exactly the moment NOT to silently resume live trading.
    // ERROR keeps assertCanTrade blocking further action until a human
    // looks at it.
    await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: { status: "ERROR", lastError: message },
    });
    throw err;
  }
}
