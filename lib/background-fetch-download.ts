"use client";

import type { FreqAIProfileConfig } from "@/lib/strategy-presets";
import { computeTrainingTimerange, DEFAULT_CORR_PAIRLIST, timeframeToMinutes } from "@/lib/training-timerange";
import { apiFetch } from "@/lib/api-client";

// Background Fetch companion to lib/client-data-download.ts (the
// foreground fallback — see that file's own doc comment for the shared
// "download client-side, then provision" design). The one real
// architectural difference: Background Fetch needs the *entire* list of
// requests up front — there's no way to inspect a response mid-flight and
// decide the next URL, unlike the foreground path's adaptive
// "since = lastCandle[0] + 1" paging. So pages here are computed on a
// fixed grid from timeframe/limit/range instead; public/sw.js's
// mergeCandlePages is what resolves any overlap or gap this can produce at
// a page boundary once every page is back.
const KLINES_PAGE_LIMIT = 1000;

// Background Fetch hands every request to the OS-level download manager
// up front — a reasonable design for a modest number of sizeable
// downloads (its actual target use case), not for an unbounded number of
// small JSON calls. resolvePairlist below now ranks auto-select pairs by
// volume and caps at AUTO_PAIRLIST_SIZE (30, see that constant's own doc
// comment in lib/hetzner.ts for why this used to be every active pair on
// the exchange instead — up to 12,000+ requests for one bot in practice),
// so the realistic worst case is now ~30 pairs × a couple of
// include_timeframes entries × dozens of pages each — comfortably in the
// low thousands, not five figures. Past this cap, isBackgroundFetchWorthwhile
// below says no and the caller (components/BotCard.tsx) falls back to the
// foreground path instead.
export const MAX_BACKGROUND_FETCH_REQUESTS = 2000;

export interface PlannedRequest {
  url: string;
  pair: string;
  timeframe: string;
}

export interface PrefetchPlan {
  requests: PlannedRequest[];
  pairCount: number;
}

interface BotForPlan {
  id: string;
  autoSelectCoins: boolean;
  pairWhitelist: string | null;
  freqaiConfig: FreqAIProfileConfig;
}

// Mirrors lib/client-data-download.ts's resolvePairlist pair resolution
// (top-N-by-volume via markets-proxy for auto-select, or the bot's own
// pairWhitelist for manual/static — see AUTO_PAIRLIST_SIZE's own doc
// comment in lib/hetzner.ts) — kept as a separate copy (rather than a
// shared import) only because that file also owns the
// foreground-specific Task/worker-pool types; the pair resolution itself
// must stay identical, since both paths have to agree on which pairs get
// downloaded for the same bot. Doesn't need to separately track/return
// which pairs came from auto-select vs DEFAULT_CORR_PAIRLIST the way that
// file does — public/sw.js's backgroundfetchsuccess handler derives that
// split itself from the completed downloads directly (see its own doc
// comment), since there's no way to run JS here again once a fetch
// finishes in the background.
async function resolvePairlist(bot: BotForPlan): Promise<string[]> {
  let pairs: string[];
  if (bot.autoSelectCoins) {
    const data = await apiFetch<{ pairs: string[] }>(
      `/api/train/cloud/markets-proxy?botId=${encodeURIComponent(bot.id)}`,
    );
    pairs = data.pairs;
  } else {
    pairs = bot.pairWhitelist ? bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean) : [];
  }
  return Array.from(new Set([...pairs, ...DEFAULT_CORR_PAIRLIST]));
}

// Deterministic replacement for the foreground path's adaptive paging loop
// — see this module's own doc comment for why Background Fetch needs the
// full request list computed before anything is fetched. Every request
// targets the same /api/train/cloud/klines-proxy route the foreground path
// uses (no server changes needed for this) — public/sw.js only has to
// parse pair/timeframe back out of each request's own URL once results
// come in, no separate metadata channel required.
export async function buildPrefetchPlan(bot: BotForPlan): Promise<PrefetchPlan> {
  const pairs = await resolvePairlist(bot);
  const timeframes = bot.freqaiConfig.features.includeTimeframes;
  const { startMs, endMs } = computeTrainingTimerange(bot.freqaiConfig);

  const requests: PlannedRequest[] = [];
  for (const pair of pairs) {
    for (const timeframe of timeframes) {
      const pageDurationMs = KLINES_PAGE_LIMIT * timeframeToMinutes(timeframe) * 60 * 1000;
      for (let since = startMs; since < endMs; since += pageDurationMs) {
        const params = new URLSearchParams({
          botId: bot.id,
          pair,
          timeframe,
          since: String(since),
          limit: String(KLINES_PAGE_LIMIT),
        });
        requests.push({ url: `/api/train/cloud/klines-proxy?${params}`, pair, timeframe });
      }
    }
  }
  return { requests, pairCount: pairs.length };
}

export function isBackgroundFetchWorthwhile(plan: PrefetchPlan): boolean {
  return plan.requests.length > 0 && plan.requests.length <= MAX_BACKGROUND_FETCH_REQUESTS;
}

// 'BackgroundFetchManager' in window is the feature-detection Chromium
// itself recommends — see this feature's own MDN page. Chrome/Edge on
// Android and desktop only; see the chat reply alongside this change for
// the full support matrix (Safari/iOS and Firefox have no Background
// Fetch implementation and use the foreground fallback unconditionally).
export function isBackgroundFetchSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "BackgroundFetchManager" in window;
}

// One Background Fetch registration for the WHOLE plan (every pair and
// timeframe together), not one per pair/timeframe — the browser surfaces
// exactly one system notification per registration (step 3 of the
// original ask), and dozens/hundreds of separate notifications for a
// single "Start Cloud Training" click would be unusable.
export async function startBackgroundFetchDownload(
  botId: string,
  botName: string,
  uploadSessionId: string,
  plan: PrefetchPlan,
): Promise<BackgroundFetchRegistration> {
  const swRegistration = await navigator.serviceWorker.ready;
  const id = `traindata:${botId}:${uploadSessionId}`;
  return swRegistration.backgroundFetch.fetch(
    id,
    plan.requests.map((r) => r.url),
    {
      title: `Marktdata ophalen voor ${botName}`,
      icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatBytes };
