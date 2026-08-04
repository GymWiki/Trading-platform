import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import type { TrainingStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";
// Default Vercel function duration (10-15s depending on plan) is too tight
// once this loop has more than one or two stale jobs to clean up — each
// iteration does a real Hetzner API call (createHetznerServer's own
// HETZNER_TIMEOUT_MS is 15s) plus a Prisma write. 60s gives enough
// headroom for a handful of orphans in one run without the function
// itself getting killed mid-loop, which would otherwise abandon whatever
// server deletes hadn't happened yet until the next scheduled run.
export const maxDuration = 60;

// A TRAINING job older than this has blown well past the cloud-init
// script's own `timeout ... 4h` ceiling (see lib/hetzner.ts maxRuntimeHours)
// plus its grace period — at this point the VM's self-destruct trap should
// already have fired, so something has gone wrong (e.g. a hard VM crash
// that never even ran the EXIT trap) and we force cleanup. This is the
// backstop for the one stage (TRAINING itself) that can legitimately run
// for hours with no intermediate checkpoint — see TRAINING_QUEUE_TIMEOUT_MINUTES
// below for every other stage, which should never take anywhere near this
// long.
const STALE_TRAINING_HOURS = 5;

// QUEUED/PULLING_IMAGE/UPLOADING are all normally a low single-digit number
// of minutes each (VM boot, docker pull, an upload of one .joblib file) —
// nothing about them scales with dataset or model size the way TRAINING
// itself (or, since it was found to genuinely need much longer — see
// DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES below — DOWNLOADING_DATA) does. A real
// report_stage() gap this long past stageUpdatedAt on one of these three
// means the VM's own script has hung or the VM never finished booting
// cloud-init at all, not that it's just slow. TRAINING itself is separately
// excluded — freqtrade's backtesting run has no intermediate checkpoint to
// report and can legitimately take hours; that stage is only bounded by
// STALE_TRAINING_HOURS above.
//
// Configurable (was hardcoded) so it can be tuned without a redeploy —
// default matches the value already in production. Investigated a report
// that this route was killing servers only 55-60s after creation: it
// wasn't — see the doc comment on isEarlyStageStale below for the actual
// cause that was found instead, which this timeout has no effect on.
const TRAINING_QUEUE_TIMEOUT_MINUTES = Number(process.env.TRAINING_QUEUE_TIMEOUT_MINUTES) || 20;

// DOWNLOADING_DATA split out from the fast stages below (2026-08-03): for an
// auto-select bot, download-data's own pair list is the wildcard ".*/USDT"
// — freqtrade's own documented way to make a dynamic VolumePairList
// backtestable (see docs/data-download.md) — which expands to every active
// USDT pair on the exchange, not just the ~30 a live/dry-run instance would
// ever actually trade. Combined with ~90 days of candles across multiple
// timeframes, and freqtrade's own download loop being fully sequential
// per (pair, timeframe) whenever the requested range doesn't fit in a
// single API call (which 90 days at 5m/15m never does — see
// _download_all_pairs_history_parallel in freqtrade's history_utils.py),
// this can legitimately take well over an hour. Mirrored into
// DOWNLOAD_DATA_TIMEOUT_SECONDS in lib/hetzner.ts, which fires 5 minutes
// before this one so the training script self-reports (with the last
// pairs it reached) instead of this route's own blind kill.
const DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES = Number(process.env.DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES) || 120;

const FAST_EARLY_STAGES: TrainingStage[] = ["QUEUED", "BOOTED", "PULLING_IMAGE", "UPLOADING"];
const SLOW_EARLY_STAGES: TrainingStage[] = ["DOWNLOADING_DATA"];
const EARLY_STAGES: TrainingStage[] = [...FAST_EARLY_STAGES, ...SLOW_EARLY_STAGES];

function earlyStageTimeoutMinutesFor(stage: TrainingStage): number {
  return SLOW_EARLY_STAGES.includes(stage) ? DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES : TRAINING_QUEUE_TIMEOUT_MINUTES;
}

// Shared with the reason text below so the two can never drift apart.
//
// This route's own timeout (20 min by default) and its cron cadence
// (~5 min, an external scheduler — see the doc comment below) were both
// investigated against a specific report of servers being deleted only
// 55-60 seconds after creation. Neither can produce that: at 5-minute
// polling, this route's very first opportunity to even look at a
// brand-new job is already past 55s, and even then it also needs
// stageUpdatedAt to be TRAINING_QUEUE_TIMEOUT_MINUTES (20 by default)
// stale before it will touch it. For the specific job reported, the
// database bore this out directly — its row wasn't touched until ~23
// minutes after creation (this route's own timeout working exactly as
// configured), while Hetzner's own activity log showed the server gone
// at ~55s. The actual deleter at that speed can only be the training
// script's own self_destruct trap (see lib/hetzner.ts trainScript) —
// it calls Hetzner's delete API directly from the VM using the embedded
// HETZNER_API_TOKEN, independent of this route entirely, and fires on
// ANY exit (success or a fail() call) within seconds of train.sh
// actually crashing. That points at train.sh failing almost immediately
// after boot — worth checking NEXT_PUBLIC_APP_URL in Vercel Production:
// if it's still a *.vercel.app URL rather than the custom domain, every
// callback/progress POST from every VM is silently swallowed by this
// same project's own Vercel Authentication wall (see the cron-job.org
// investigation this session), which would explain why no job has ever
// reported back even though the VM demonstrably reaches the internet
// fine (its self-destruct call to Hetzner's API succeeds).
function isEarlyStageStale(stage: TrainingStage, stageUpdatedAt: Date, now: number): boolean {
  return EARLY_STAGES.includes(stage) && now - stageUpdatedAt.getTime() > earlyStageTimeoutMinutesFor(stage) * 60 * 1000;
}

// Plain string comparison would leak timing information about how many
// leading characters of the presented token matched CRON_SECRET. This is
// hit over plain HTTP by an external scheduler (not Vercel's own signed
// cron mechanism), so treat the Authorization header like any other
// untrusted bearer token.
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Same diagnostic shape as requireHetznerToken() in lib/hetzner.ts —
    // never log the header value itself, just confirm (server-side only,
    // in Vercel's function logs) that our own config is the problem rather
    // than leaving every call silently 401 with nothing to go on.
    console.error("[train/cloud/reap] CRON_SECRET is not configured — every call will be rejected as Unauthorized.");
    return false;
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// Failsafe layer 3 of 3: catches whatever layers 1 (the VM's own trap) and 2
// (the callback route's redundant delete) missed — a hard VM crash that
// never ran any shutdown code at all, or cloud-init itself hanging before
// the script ever got to run. That failure mode never reaches TRAINING's
// own 4h self-timeout, so without TRAINING_QUEUE_TIMEOUT_MINUTES a stuck
// job just sat there showing a frozen, purely time-interpolated percentage
// (see GET /api/train/cloud/status) for up to STALE_TRAINING_HOURS with
// nothing to suggest it was actually dead.
//
// Triggered by an external scheduler (cron-job.org) hitting this URL with
// an `Authorization: Bearer <CRON_SECRET>` header configured on the
// scheduler's side — deliberately not Vercel Cron, so this route makes no
// assumption about how the request was scheduled and only ever trusts a
// literal, exact bearer-token match. Observed cadence in practice (this
// route's own Vercel request logs) is every ~5 minutes — investigated
// specifically after a report that servers were being deleted only 55-60s
// after creation, in case this cron was somehow running once a minute;
// it isn't, and even at 5-minute polling a brand-new job still gets
// several minutes' head start before this route looks at it even once,
// on top of the TRAINING_QUEUE_TIMEOUT_MINUTES minutes of staleness it
// also requires before acting — see isEarlyStageStale's doc comment for
// what turned out to actually be deleting those servers that fast.
// Exported as both GET and POST below since this is a pure trigger with
// no body to read — which HTTP method the external scheduler is
// configured to send doesn't change anything about what this does, so
// there's no reason to make that a way for this to fail (Next.js 405s
// any method that isn't exported).
const handleReap = withErrorHandling(async (req: NextRequest) => {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_TRAINING_HOURS * 60 * 60 * 1000);
  const fastEarlyStaleCutoff = new Date(now - TRAINING_QUEUE_TIMEOUT_MINUTES * 60 * 1000);
  const downloadDataStaleCutoff = new Date(now - DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES * 60 * 1000);
  console.log(
    `[train/cloud/reap] run started at ${new Date(now).toISOString()} — ` +
      `TRAINING_QUEUE_TIMEOUT_MINUTES=${TRAINING_QUEUE_TIMEOUT_MINUTES}, ` +
      `DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES=${DOWNLOAD_DATA_QUEUE_TIMEOUT_MINUTES}, ` +
      `STALE_TRAINING_HOURS=${STALE_TRAINING_HOURS}`,
  );

  const orphans = await prisma.trainingJob.findMany({
    where: {
      hetznerServerId: { not: null },
      OR: [
        { status: "TRAINING", updatedAt: { lt: staleCutoff } },
        { status: "TRAINING", stage: { in: FAST_EARLY_STAGES }, stageUpdatedAt: { lt: fastEarlyStaleCutoff } },
        { status: "TRAINING", stage: { in: SLOW_EARLY_STAGES }, stageUpdatedAt: { lt: downloadDataStaleCutoff } },
        // Also sweeps up a CANCELLED job (POST /api/train/cloud/stop) whose
        // own Hetzner delete call failed and left hetznerServerId set —
        // that route deliberately keeps it set in exactly that case so
        // this backstop can retry.
        { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } },
      ],
    },
  });

  const results: Array<{ jobId: string; serverId: string; ok: boolean }> = [];

  for (const job of orphans) {
    if (!job.hetznerServerId) continue;

    const earlyStale = isEarlyStageStale(job.stage, job.stageUpdatedAt, now);
    const stageTimeoutMinutes = earlyStageTimeoutMinutesFor(job.stage);
    const staleReason = earlyStale
      ? `Reaped: no progress past ${job.stage} for over ${stageTimeoutMinutes} minutes — the training VM likely crashed or never finished booting`
      : "Reaped: exceeded max training runtime";
    const isStale = job.status === "TRAINING";

    // Explicit, per-job: exactly what point 4 asked for — how long the
    // job had been running, which timeout applied, and why (or why not)
    // this run is acting on it, without needing external Hetzner logs to
    // reconstruct any of that after the fact.
    const ageMinutes = Math.round((now - job.createdAt.getTime()) / 60000);
    const sinceStageMinutes = Math.round((now - job.stageUpdatedAt.getTime()) / 60000);
    console.log(
      `[train/cloud/reap] job ${job.id}: status=${job.status} stage=${job.stage} ` +
        `age=${ageMinutes}min sinceStageUpdate=${sinceStageMinutes}min ` +
        `earlyStageTimeout=${stageTimeoutMinutes}min staleTrainingTimeout=${STALE_TRAINING_HOURS}h ` +
        `-> ${isStale ? `REAP (${staleReason})` : "cleanup only (already terminal, just clearing hetznerServerId)"}`,
    );

    try {
      await deleteHetznerServer(job.hetznerServerId);
      await prisma.trainingJob.update({
        where: { id: job.id },
        data: {
          hetznerServerId: null,
          status: isStale ? "FAILED" : job.status,
          errorMessage: isStale ? staleReason : job.errorMessage,
        },
      });

      // Mirror POST /api/train/cloud/callback's own FAILED handling — that
      // is the only other place a TrainingJob ever flips to FAILED, and it
      // always frees the bot too (status: ERROR) so the user isn't left
      // permanently stuck behind assertCanTrade/TrainingBusyError with no
      // way to retry. Skipping this used to leave a reaped bot wedged in
      // TRAINING/UPDATING_MODEL forever, even after its dead job was
      // correctly marked FAILED.
      if (isStale) {
        await prisma.botConfiguration.update({
          where: { id: job.botId },
          data: { status: "ERROR", lastError: staleReason },
        });
      }

      results.push({ jobId: job.id, serverId: job.hetznerServerId, ok: true });
    } catch (err) {
      console.error(`[train/cloud/reap] job ${job.id}: deleteHetznerServer(${job.hetznerServerId}) failed, leaving DB untouched for retry next run:`, err);
      results.push({ jobId: job.id, serverId: job.hetznerServerId, ok: false });
    }
  }

  // Separate sweep for a job that never even got this far: still status
  // QUEUED, meaning startCloudTrainingJob (lib/train-cloud.ts) never
  // reached the update that both sets hetznerServerId AND flips status to
  // TRAINING. The one way that can happen without also hitting that
  // function's own catch block (which already marks FAILED) is the
  // platform killing the request mid-flight — a Vercel function timeout
  // during the createHetznerServer call skips the catch entirely. Every
  // other branch above requires hetznerServerId to be set, so a job stuck
  // exactly here — no server, nothing to delete — would otherwise be
  // invisible to this cron forever.
  const stuckQueued = await prisma.trainingJob.findMany({
    where: { status: "QUEUED", createdAt: { lt: fastEarlyStaleCutoff } },
  });
  for (const job of stuckQueued) {
    const reason =
      "Reaped: job never left QUEUED — the request that provisions the Hetzner server likely timed out or crashed before it could run";
    const ageMinutes = Math.round((now - job.createdAt.getTime()) / 60000);
    console.log(
      `[train/cloud/reap] job ${job.id}: status=QUEUED age=${ageMinutes}min ` +
        `earlyStageTimeout=${TRAINING_QUEUE_TIMEOUT_MINUTES}min, no hetznerServerId ever recorded -> REAP (${reason})`,
    );
    await prisma.trainingJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: reason },
    });
    await prisma.botConfiguration.update({
      where: { id: job.botId },
      data: { status: "ERROR", lastError: reason },
    });
    results.push({ jobId: job.id, serverId: "(none)", ok: true });
  }

  console.log(`[train/cloud/reap] run finished — ${results.length} job(s) reaped/cleaned`);
  return NextResponse.json({ reaped: results.length, results });
});

export const GET = handleReap;
export const POST = handleReap;
