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
// for hours with no intermediate checkpoint — see EARLY_STAGE_STALE_MINUTES
// below for every other stage, which should never take anywhere near this
// long.
const STALE_TRAINING_HOURS = 5;

// QUEUED/PULLING_IMAGE/DOWNLOADING_DATA/UPLOADING are all normally a low
// single-digit number of minutes each (docker pull, a candle-data download,
// an upload of one .joblib file) — nothing about them scales with dataset
// or model size the way the TRAINING stage itself does, so a real report_stage()
// gap this long past stageUpdatedAt means the VM's own script has hung or
// the VM never finished booting cloud-init at all (a real incident: apt/dpkg
// lock contention with Ubuntu's unattended-upgrades timer is a known cause
// of exactly this on a fresh cloud image), not that it's just slow. TRAINING
// itself is deliberately excluded — freqtrade's backtesting run has no
// intermediate checkpoint to report and can legitimately take hours; that
// stage is only bounded by STALE_TRAINING_HOURS above.
const EARLY_STAGE_STALE_MINUTES = 20;
const EARLY_STAGES: TrainingStage[] = ["QUEUED", "PULLING_IMAGE", "DOWNLOADING_DATA", "UPLOADING"];

// Shared with the reason text below so the two can never drift apart.
function isEarlyStageStale(stage: TrainingStage, stageUpdatedAt: Date, now: number): boolean {
  return EARLY_STAGES.includes(stage) && now - stageUpdatedAt.getTime() > EARLY_STAGE_STALE_MINUTES * 60 * 1000;
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
// never ran any shutdown code at all, or (the case this route used to miss
// entirely) cloud-init itself hanging before the script ever got to run —
// e.g. apt/dpkg lock contention with Ubuntu's unattended-upgrades timer on
// a fresh image. That failure mode never reaches TRAINING's own 4h
// self-timeout, so without EARLY_STAGE_STALE_MINUTES a stuck job just sat
// there showing a frozen, purely time-interpolated percentage (see GET
// /api/train/cloud/status) for up to STALE_TRAINING_HOURS with nothing to
// suggest it was actually dead.
//
// Triggered by an external scheduler (e.g. cron-job.org) hitting this URL
// every ~15 minutes with an `Authorization: Bearer <CRON_SECRET>` header
// configured on the scheduler's side — deliberately not Vercel Cron, so
// this route makes no assumption about how the request was scheduled and
// only ever trusts a literal, exact bearer-token match. Exported as both
// GET and POST below since this is a pure trigger with no body to read —
// which HTTP method the external scheduler is configured to send doesn't
// change anything about what this does, so there's no reason to make that
// a way for this to fail (Next.js 405s any method that isn't exported).
const handleReap = withErrorHandling(async (req: NextRequest) => {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_TRAINING_HOURS * 60 * 60 * 1000);
  const earlyStaleCutoff = new Date(now - EARLY_STAGE_STALE_MINUTES * 60 * 1000);

  const orphans = await prisma.trainingJob.findMany({
    where: {
      hetznerServerId: { not: null },
      OR: [
        { status: "TRAINING", updatedAt: { lt: staleCutoff } },
        { status: "TRAINING", stage: { in: EARLY_STAGES }, stageUpdatedAt: { lt: earlyStaleCutoff } },
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

    const staleReason = isEarlyStageStale(job.stage, job.stageUpdatedAt, now)
      ? `Reaped: no progress past ${job.stage} for over ${EARLY_STAGE_STALE_MINUTES} minutes — the training VM likely crashed or never finished booting`
      : "Reaped: exceeded max training runtime";
    const isStale = job.status === "TRAINING";

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
    } catch {
      results.push({ jobId: job.id, serverId: job.hetznerServerId, ok: false });
    }
  }

  return NextResponse.json({ reaped: results.length, results });
});

export const GET = handleReap;
export const POST = handleReap;
