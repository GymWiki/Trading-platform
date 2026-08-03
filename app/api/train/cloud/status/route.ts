import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// Freqtrade's `backtesting` command (how FreqAI training actually runs —
// see lib/hetzner.ts buildFreqAITrainingCloudInit) has no fine-grained
// progress API of its own to poll or parse from stdout robustly, so this
// endpoint blends two real signals instead of inventing a fake one:
//  1. Which stage the VM's script last actually reported reaching (see
//     POST /api/train/cloud/progress) — a genuine checkpoint, not a guess.
//  2. How long this bot's own past completed runs took — used to turn
//     "we're in the TRAINING stage" into a smooth, continuously-advancing
//     percentage and an ETA, by interpolating time spent in the current
//     stage against that stage's expected share of the average run.
// Falls back to a fixed default duration when there's no history yet
// (this bot's first-ever run) — still time-based, just without a
// personalized baseline yet.
const DEFAULT_AVG_DURATION_SECONDS = 20 * 60;
const MIN_STAGE_DURATION_SECONDS = 30; // floor so a near-zero avg duration can't make a stage "complete" instantly

// Cumulative percent at the moment each stage is *entered* — approximate,
// hand-calibrated to how long each phase typically takes relative to the
// others (TRAINING/backtesting dominates; pulling the Docker image and
// downloading history are comparatively quick; the upload is fast once
// the model file exists). Not exact per-run, which is exactly why stage
// transitions (real) get blended with elapsed-time interpolation (estimated)
// rather than trusting either alone.
const STAGE_ORDER = ["QUEUED", "BOOTED", "PULLING_IMAGE", "DOWNLOADING_DATA", "TRAINING", "UPLOADING", "DONE"] as const;
type Stage = (typeof STAGE_ORDER)[number];
const STAGE_FLOOR_PERCENT: Record<Stage, number> = {
  QUEUED: 0,
  BOOTED: 3,
  PULLING_IMAGE: 5,
  DOWNLOADING_DATA: 15,
  TRAINING: 30,
  UPLOADING: 90,
  DONE: 100,
};

async function getAverageDurationSeconds(botId: string, userId: string): Promise<number> {
  const recent = { orderBy: { createdAt: "desc" as const }, take: 5, select: { createdAt: true, updatedAt: true } };
  let jobs = await prisma.trainingJob.findMany({ where: { botId, status: "COMPLETED" }, ...recent });
  if (jobs.length === 0) {
    // No history for this exact bot yet — this user's other bots' runs
    // are still a more relevant baseline than a hardcoded global guess.
    jobs = await prisma.trainingJob.findMany({ where: { userId, status: "COMPLETED" }, ...recent });
  }
  if (jobs.length === 0) return DEFAULT_AVG_DURATION_SECONDS;
  const durations = jobs.map((j) => (j.updatedAt.getTime() - j.createdAt.getTime()) / 1000);
  return durations.reduce((sum, d) => sum + d, 0) / durations.length;
}

function computeProgress(
  stage: Stage,
  createdAt: Date,
  stageUpdatedAt: Date,
  avgDurationSeconds: number,
): { percentComplete: number; elapsedSeconds: number; estimatedRemainingSeconds: number } {
  const now = Date.now();
  const elapsedSeconds = Math.max(0, (now - createdAt.getTime()) / 1000);

  const currentIndex = STAGE_ORDER.indexOf(stage);
  const nextStage = STAGE_ORDER[Math.min(currentIndex + 1, STAGE_ORDER.length - 1)];
  const currentFloor = STAGE_FLOOR_PERCENT[stage];
  const nextFloor = STAGE_FLOOR_PERCENT[nextStage];

  const timeIntoStageSeconds = Math.max(0, (now - stageUpdatedAt.getTime()) / 1000);
  const expectedStageDurationSeconds = Math.max(
    MIN_STAGE_DURATION_SECONDS,
    (avgDurationSeconds * (nextFloor - currentFloor)) / 100,
  );
  const stageProgress = Math.min(1, timeIntoStageSeconds / expectedStageDurationSeconds);

  // Capped just under 100 while still in progress — only the terminal
  // COMPLETED status (checked by the caller) is allowed to actually show
  // 100%, so the bar never claims "done" a beat before the real signal.
  const percentComplete = Math.min(99, Math.round(currentFloor + stageProgress * (nextFloor - currentFloor)));
  const estimatedRemainingSeconds = Math.max(0, Math.round(((100 - percentComplete) / 100) * avgDurationSeconds));

  return { percentComplete, elapsedSeconds: Math.round(elapsedSeconds), estimatedRemainingSeconds };
}

export const GET = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query parameter is required" }, { status: 400 });
  }

  const job = await prisma.trainingJob.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: "Training job not found" }, { status: 404 });
  }

  if (job.status === "COMPLETED") {
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      stage: "DONE",
      percentComplete: 100,
      elapsedSeconds: Math.round((job.updatedAt.getTime() - job.createdAt.getTime()) / 1000),
      estimatedRemainingSeconds: 0,
      errorMessage: null,
    });
  }

  const avgDurationSeconds = await getAverageDurationSeconds(job.botId, user.id);

  if (job.status === "FAILED" || job.status === "CANCELLED") {
    // Freeze the estimate at whatever it would have been at the moment of
    // failure/cancellation — still informative ("it got about this far")
    // without implying the job is still progressing.
    const { percentComplete, elapsedSeconds } = computeProgress(
      job.stage as Stage,
      job.createdAt,
      job.stageUpdatedAt,
      avgDurationSeconds,
    );
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      percentComplete,
      elapsedSeconds,
      estimatedRemainingSeconds: null,
      errorMessage: job.errorMessage,
    });
  }

  // QUEUED or TRAINING (overall status) — still in progress.
  const { percentComplete, elapsedSeconds, estimatedRemainingSeconds } = computeProgress(
    job.stage as Stage,
    job.createdAt,
    job.stageUpdatedAt,
    avgDurationSeconds,
  );

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    percentComplete,
    elapsedSeconds,
    estimatedRemainingSeconds,
    errorMessage: null,
  });
});
