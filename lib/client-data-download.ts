"use client";

import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api-client";
import { computeTrainingTimerange, DEFAULT_CORR_PAIRLIST } from "@/lib/training-timerange";
import type { FreqAIProfileConfig } from "@/lib/strategy-presets";

// The client-side counterpart to buildFreqAITrainingCloudInit's
// preloadedData branch (lib/hetzner.ts) — fetches historical candles over
// the user's own connection (see /api/train/cloud/{markets,klines}-proxy's
// own doc comments for why a direct browser fetch to the exchange isn't
// possible) and uploads each (pair, timeframe) file to Storage via
// POST /api/train/cloud/upload-data, BEFORE any VPS is ever provisioned —
// see components/BotCard.tsx's handleStartCloudTraining for the caller
// that only starts the VPS once this whole function has resolved
// successfully.
//
// Deliberately does NOT stage every pair's candles in memory/IndexedDB at
// once: each (pair, timeframe) task is fetched, uploaded, and dropped
// before the next one starts (bounded concurrency below), so at most a
// small, fixed number of tasks' candles are ever resident in memory
// regardless of how many pairs a bot ends up training on.

const KLINES_PAGE_LIMIT = 1000;
const MAX_CONCURRENT_TASKS = 4;
const MODELS_BUCKET = "models";

export interface DownloadTaskProgress {
  completedTasks: number;
  totalTasks: number;
  /** The (pair, timeframe) currently in flight for each of the concurrent workers — empty once everything is done. */
  inFlight: Array<{ pair: string; timeframe: string }>;
}

export interface PreloadedDataResult {
  uploadSessionId: string;
  files: Array<{ pair: string; timeframe: string }>;
  /**
   * Set only for an auto-select bot — the exact top-N-by-volume pairs
   * resolved client-side (see resolvePairlist below), to be forwarded to
   * POST /api/train/cloud so buildFreqAITrainingCloudInit can freeze the
   * training run's pairlist to exactly these pairs instead of leaving
   * VolumePairList to re-rank by volume again at backtest time — see that
   * param's own doc comment in lib/hetzner.ts for why.
   */
  resolvedAutoSelectPairs?: string[];
}

export class ClientDataDownloadError extends Error {}

interface BotForDownload {
  id: string;
  autoSelectCoins: boolean;
  /** Comma-joined, same as BotConfigurationDTO.pairWhitelist. */
  pairWhitelist: string | null;
  freqaiConfig: FreqAIProfileConfig;
}

interface ResolvedPairlist {
  /** Every pair to actually fetch/upload candles for — the trading-relevant pairs plus DEFAULT_CORR_PAIRLIST's correlation-only pair. */
  downloadPairs: string[];
  /** Set only for an auto-select bot — see PreloadedDataResult.resolvedAutoSelectPairs's own doc comment for why this is kept separate from downloadPairs. */
  resolvedAutoSelectPairs?: string[];
}

// markets-proxy now returns the same top-N-by-volume pairlist a live
// auto-select bot's VolumePairList would use (see AUTO_PAIRLIST_SIZE's own
// doc comment in lib/hetzner.ts for why this used to be every active pair
// on the exchange instead, and why that turned out to be impractical to
// fetch client-side) — see DEFAULT_CORR_PAIRLIST's own doc comment for why
// BTC/USDT is always unioned into downloadPairs regardless of mode.
async function resolvePairlist(bot: BotForDownload, signal: AbortSignal): Promise<ResolvedPairlist> {
  if (bot.autoSelectCoins) {
    const data = await apiFetch<{ pairs: string[] }>(`/api/train/cloud/markets-proxy?botId=${encodeURIComponent(bot.id)}`, {
      signal,
    });
    return {
      downloadPairs: Array.from(new Set([...data.pairs, ...DEFAULT_CORR_PAIRLIST])),
      resolvedAutoSelectPairs: data.pairs,
    };
  }
  const pairs = bot.pairWhitelist ? bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean) : [];
  return { downloadPairs: Array.from(new Set([...pairs, ...DEFAULT_CORR_PAIRLIST])) };
}

interface Task {
  pair: string;
  timeframe: string;
}

// Pages forward from startMs until either a short page (fewer than
// KLINES_PAGE_LIMIT candles) signals "caught up to now", or the last
// candle's own timestamp reaches endMs — same end-of-data signal any
// paginated OHLCV fetch uses (see lib/market-data-client.ts's own doc
// comment on fetchOhlcvPage).
async function fetchAllCandles(
  botId: string,
  pair: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  signal: AbortSignal,
): Promise<number[][]> {
  const candles: number[][] = [];
  let since = startMs;
  for (;;) {
    const params = new URLSearchParams({
      botId,
      pair,
      timeframe,
      since: String(since),
      limit: String(KLINES_PAGE_LIMIT),
    });
    const data = await apiFetch<{ candles: number[][] }>(`/api/train/cloud/klines-proxy?${params}`, { signal });
    const page = data.candles;
    if (!page || page.length === 0) break;

    for (const candle of page) {
      if (candle[0] <= endMs) candles.push(candle);
    }

    const lastTs = page[page.length - 1][0];
    if (page.length < KLINES_PAGE_LIMIT || lastTs >= endMs) break;
    since = lastTs + 1;
  }
  return candles;
}

// One task: fetch a pair/timeframe's full candle range, then immediately
// upload it (skipped entirely if there turned out to be no data at all —
// e.g. a pair that didn't exist yet at the start of the range) and drop the
// array. Returns null when skipped so the caller doesn't count it as an
// uploaded file.
async function runTask(
  botId: string,
  uploadSessionId: string,
  task: Task,
  startMs: number,
  endMs: number,
  signal: AbortSignal,
): Promise<Task | null> {
  const candles = await fetchAllCandles(botId, task.pair, task.timeframe, startMs, endMs, signal);
  if (candles.length === 0) return null;

  const { uploadUrl, token, path } = await apiFetch<{ uploadUrl: string; token: string; path: string }>(
    "/api/train/cloud/upload-data",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botId, uploadSessionId, pair: task.pair, timeframe: task.timeframe }),
      signal,
    },
  );

  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.storage
    .from(MODELS_BUCKET)
    .uploadToSignedUrl(path, token, new Blob([JSON.stringify(candles)], { type: "application/json" }));
  if (error) {
    throw new ClientDataDownloadError(`Upload mislukt voor ${task.pair} ${task.timeframe}: ${error.message}`);
  }
  void uploadUrl; // returned for symmetry with the model-upload flow; uploadToSignedUrl only needs path+token
  return task;
}

// Runs every (pair, timeframe) task with bounded concurrency (rather than
// all at once, which could open dozens of simultaneous proxy requests for
// an auto-select bot with a large pairlist) and reports real progress —
// completedTasks/totalTasks, exactly as the user asked for, not an
// estimate.
export async function downloadAndUploadTrainingData(
  bot: BotForDownload,
  opts: { signal: AbortSignal; onProgress: (progress: DownloadTaskProgress) => void },
): Promise<PreloadedDataResult> {
  const { signal, onProgress } = opts;

  const { downloadPairs, resolvedAutoSelectPairs } = await resolvePairlist(bot, signal);
  if (downloadPairs.length === 0) {
    throw new ClientDataDownloadError("Geen coins geselecteerd om data voor op te halen.");
  }

  const { startMs, endMs } = computeTrainingTimerange(bot.freqaiConfig);
  const timeframes = bot.freqaiConfig.features.includeTimeframes;

  const tasks: Task[] = [];
  for (const pair of downloadPairs) {
    for (const timeframe of timeframes) {
      tasks.push({ pair, timeframe });
    }
  }

  const uploadSessionId = crypto.randomUUID();
  const uploadedFiles: Task[] = [];
  let completedTasks = 0;
  const inFlight = new Map<number, Task>();

  const emitProgress = () => {
    onProgress({ completedTasks, totalTasks: tasks.length, inFlight: Array.from(inFlight.values()) });
  };
  emitProgress();

  let nextIndex = 0;
  let firstError: unknown = null;

  async function worker(workerId: number) {
    for (;;) {
      if (signal.aborted || firstError) return;
      const index = nextIndex++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      inFlight.set(workerId, task);
      emitProgress();
      try {
        const uploaded = await runTask(bot.id, uploadSessionId, task, startMs, endMs, signal);
        if (uploaded) uploadedFiles.push(uploaded);
      } catch (err) {
        if (!firstError) firstError = err;
        return;
      } finally {
        completedTasks++;
        inFlight.delete(workerId);
        emitProgress();
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_TASKS, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i)));

  if (signal.aborted) {
    throw new ClientDataDownloadError("Download geannuleerd.");
  }
  if (firstError) {
    throw firstError instanceof Error
      ? firstError
      : new ClientDataDownloadError("Ophalen van historische data is mislukt.");
  }
  if (uploadedFiles.length === 0) {
    throw new ClientDataDownloadError(
      "Er kon geen historische data worden opgehaald voor de geselecteerde coins/timeframes.",
    );
  }

  return { uploadSessionId, files: uploadedFiles, resolvedAutoSelectPairs };
}
