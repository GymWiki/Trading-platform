import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { decrypt } from "@/lib/encryption";
import { buildFreqAITrainingCloudInit, createHetznerServer, requireHetznerToken } from "@/lib/hetzner";
import { DEFAULT_PAPER_TOTAL_BUDGET, DEFAULT_PAPER_MAX_STAKE_PERCENTAGE } from "@/lib/paper-trading-defaults";
import { generateCallbackToken, hashCallbackToken } from "@/lib/training-token";
import { stopBot, forceExitAll } from "@/lib/freqtrade-client";
import { pairToFreqtradeFilename } from "@/lib/freqtrade-format";
import type { FreqAIProfileConfig } from "@/lib/strategy-presets";

type BotRow = Prisma.BotConfigurationGetPayload<object>;

const TRAINING_SERVER_TYPE = process.env.HETZNER_TRAINING_SERVER_TYPE || "cpx31";
const MODELS_BUCKET = "models";
// Comfortably longer than PULLING_IMAGE could ever realistically take
// (the one stage that runs before the VM curls these) — a signed download
// URL only has to survive from "job created" to "preloadedDataScript's
// curl calls run", not the whole training run (contrast
// /api/train/cloud/upload-url's ~2h signed *upload* URL, which has to
// survive until training finishes).
const PRELOADED_DATA_URL_EXPIRY_SECONDS = 3600;

export class TrainingBusyError extends Error {}

interface StartCloudTrainingParams {
  bot: BotRow;
  /** Force-close open positions before pausing, instead of just halting new entries. Only meaningful if the bot is currently deployed (paper or live). */
  cancelOpenOrders?: boolean;
  /**
   * Set only by the client-side pre-fetch flow (see
   * components/BotCard.tsx's handleStartCloudTraining and
   * lib/client-data-download.ts) — the browser has already fetched and
   * uploaded every (pair, timeframe) file to Storage under
   * `${bot.userId}/${bot.id}/training-data/${uploadSessionId}/` (see
   * app/api/train/cloud/upload-data/route.ts) before this function is even
   * called. `files` is the browser's own record of which ones it uploaded;
   * this function still mints (and can fail on) real signed URLs for each
   * exact path rather than trusting that the objects exist.
   */
  preloadedData?: { uploadSessionId: string; files: Array<{ pair: string; timeframe: string }> };
  /** Only meaningful together with preloadedData when bot.autoSelectCoins is true — see that param's own doc comment on buildFreqAITrainingCloudInit in lib/hetzner.ts. */
  resolvedAutoSelectPairs?: string[];
}

// Mints signed GET URLs for every uploaded training-data file so the VM can
// curl them directly (see preloadedDataScript in lib/hetzner.ts). Uses the
// service-role key rather than a user session: this function has no request
// context of its own (it's also called from the retrain_needed webhook
// path, which never has a browser session), and every path here is
// computed entirely from our own trusted bot/job identifiers, never from
// caller input — same reasoning as /api/train/cloud/upload-url's own
// service-role usage.
async function resolvePreloadedDataUrls(
  bot: BotRow,
  preloadedData: NonNullable<StartCloudTrainingParams["preloadedData"]>,
): Promise<Array<{ pair: string; timeframe: string; downloadUrl: string }>> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  const supabase = createServiceRoleClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);

  const objectPaths = preloadedData.files.map(
    ({ pair, timeframe }) =>
      `${bot.userId}/${bot.id}/training-data/${preloadedData.uploadSessionId}/${pairToFreqtradeFilename(pair)}-${timeframe}.json`,
  );
  const { data, error } = await supabase.storage.from(MODELS_BUCKET).createSignedUrls(objectPaths, PRELOADED_DATA_URL_EXPIRY_SECONDS);
  if (error || !data) {
    throw new Error(`Could not create signed download URLs for preloaded training data: ${error?.message}`);
  }
  return preloadedData.files.map(({ pair, timeframe }, i) => {
    const entry = data[i];
    if (!entry || entry.error || !entry.signedUrl) {
      throw new Error(
        `Preloaded training data missing or inaccessible for ${pair} ${timeframe} (uploadSessionId=${preloadedData.uploadSessionId}): ${entry?.error ?? "not found"}`,
      );
    }
    return { pair, timeframe, downloadUrl: entry.signedUrl };
  });
}

// The single place a cloud training job gets created — called directly by
// POST /api/train/cloud (user clicked "Start Cloud Training") and by
// POST /api/bots/[id]/status handling a "retrain_needed" event from a
// deployed bot. Both paths get the same priority guarantee for free: if
// the bot is currently deployed — paper or live, both actually run the
// freqtrade loop — it is genuinely paused (via its own freqtrade REST API,
// not just a database flag) before any training bookkeeping happens.
export async function startCloudTrainingJob({
  bot,
  cancelOpenOrders = false,
  preloadedData,
  resolvedAutoSelectPairs,
}: StartCloudTrainingParams) {
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
  // Was a second, separately-maintained copy of this exact check — now the
  // one in lib/hetzner.ts (which also logs which HETZNER_* env vars are
  // actually present, server-side only, when this throws) so there's a
  // single place to keep the error message and diagnostics in sync.
  const hetznerApiToken = requireHetznerToken();

  // Priority rule: training/updating always wins over active trading
  // (paper or live), and the pause must be real, not just a status label —
  // hence the freqtrade API call, using this bot's own per-deployment
  // credentials. deployBotToVps derives the resume status from
  // isPaperTrading, so whichever phase this was in is exactly what it
  // resumes to.
  //
  // deploymentStatus, not status: TRAINING_PAPER_TRADE is this bot's
  // status from the moment it's *created*, not just while it's actually
  // running on a VPS — a bot that has never been deployed is also
  // TRAINING_PAPER_TRADE, but has no server to pause and no freqtrade
  // REST API credentials to pause it with. Checking bot.status here
  // treated every brand-new bot as "already deployed", so its very first
  // Start Cloud Training click always hit the credentials check below and
  // failed — nothing to do with the bot's own exchange account (see
  // lib/deploy-bot.ts for that, separate, gate). VPS_ACTIVE is the actual
  // "is there a running deployment to pause" signal.
  const wasDeployed = bot.deploymentStatus === "VPS_ACTIVE";
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
    // Resolved before buildFreqAITrainingCloudInit so a missing/expired
    // upload is caught here — inside this same try/catch, before any
    // Hetzner API call is ever made — rather than only surfacing much
    // later as an opaque curl failure on the VM itself.
    const preloadedFileUrls = preloadedData ? await resolvePreloadedDataUrls(bot, preloadedData) : undefined;

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
      autoCompound: bot.autoCompound,
      uploadUrlEndpoint: `${appUrl}/api/train/cloud/upload-url`,
      callbackUrl: `${appUrl}/api/train/cloud/callback`,
      progressUrl: `${appUrl}/api/train/cloud/progress`,
      callbackToken,
      hetznerApiToken,
      preloadedData: preloadedFileUrls,
      resolvedAutoSelectPairs,
    });

    // Explicit markers either side of the one call that actually leaves
    // the DB — if a job is ever found stuck at QUEUED with no
    // hetznerServerId, these two lines (present or not, in Vercel's
    // function logs for this invocation) are what tells you whether
    // createHetznerServer was ever reached at all, versus started and
    // never returned (the platform killing the function mid-call being
    // the one failure mode that skips the catch block below entirely).
    console.log(`[train-cloud] job ${job.id}: requesting Hetzner server (type=${TRAINING_SERVER_TYPE})`);
    const { server } = await createHetznerServer({
      name: `train-${job.id}`,
      cloudInit,
      serverType: TRAINING_SERVER_TYPE,
      firewallProfile: "training",
    });
    console.log(`[train-cloud] job ${job.id}: Hetzner server ${server.id} created, flipping QUEUED -> TRAINING`);

    return await prisma.trainingJob.update({
      where: { id: job.id },
      data: { status: "TRAINING", hetznerServerId: String(server.id) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start cloud training";
    console.error(`[train-cloud] job ${job.id}: provisioning failed, marking FAILED — ${message}`);
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
