import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, hashCallbackToken } from "@/lib/training-token";
import { deleteHetznerServer } from "@/lib/hetzner";
import { deployBotToVps } from "@/lib/deploy-bot";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

const MAX_ERROR_MESSAGE_LENGTH = 2000;

const callbackBodySchema = z.object({
  status: z.enum(["COMPLETED", "FAILED"]),
  // Deliberately NOT length-bounded here (unlike most Zod schemas in this
  // app, which reject out-of-range input): rejecting an over-long message
  // with a 400 would leave this job stuck QUEUED/TRAINING forever, since
  // the training VM only calls this endpoint once. Truncating below is
  // safer than failing the one callback that's supposed to record the
  // terminal status no matter what.
  errorMessage: z.string().nullish(),
});

// Called once by the training VM when it finishes (successfully or not).
// This is failsafe layer 2 of 3: on top of the VM's own trap-based
// self-destruct (layer 1) and the /api/train/cloud/reap cron backstop
// (layer 3), we also attempt the delete here ourselves, using our own
// privileged HETZNER_API_TOKEN rather than the one embedded in cloud-init —
// redundant on purpose, in case the VM's own delete call fails.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const job = await prisma.trainingJob.findUnique({
    where: { callbackTokenHash: hashCallbackToken(token) },
  });
  if (!job) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Idempotent: the VM's cleanup trap may report a second time (e.g. if a
  // curl retried). Terminal jobs just acknowledge without re-processing.
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({ ok: true });
  }

  const parsed = await parseJsonBody(req, callbackBodySchema);
  if ("error" in parsed) return parsed.error;
  const { status } = parsed.data;
  const errorMessage = parsed.data.errorMessage?.slice(0, MAX_ERROR_MESSAGE_LENGTH) ?? null;

  // A COMPLETED report with no recorded model path is a contradiction —
  // the upload-url route always sets aiModelPath before the VM could have
  // uploaded anything. Treat it as a failure rather than trust the claim.
  const finalStatus = status === "COMPLETED" && !job.aiModelPath ? "FAILED" : status;
  const finalErrorMessage =
    finalStatus === "FAILED" && !errorMessage && status === "COMPLETED"
      ? "Reported COMPLETED but no model path was ever recorded for this job"
      : (errorMessage ?? null);

  await prisma.trainingJob.update({
    where: { id: job.id },
    data: { status: finalStatus, errorMessage: finalErrorMessage },
  });

  const bot = await prisma.botConfiguration.findUnique({ where: { id: job.botId } });

  if (finalStatus === "COMPLETED" && job.aiModelPath && bot) {
    await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: { aiModelPath: job.aiModelPath },
    });

    if (bot.status === "UPDATING_MODEL") {
      // This training run was a retrain for an already-deployed bot (see
      // lib/train-cloud.ts, which paused it before creating this job) — the
      // priority cycle only completes once the new model is actually
      // redeployed and trading resumes. Hetzner doesn't support re-running
      // cloud-init on an existing server, so "redeploy" here means
      // delete-and-recreate with the new model — deployBotToVps handles
      // that and resumes to TRAINING_PAPER_TRADE or LIVE_TRADING (whichever
      // isPaperTrading says this bot actually was) on success.
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      try {
        if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
        const supabase = createServiceRoleClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);
        const freshBot = await prisma.botConfiguration.findUniqueOrThrow({ where: { id: bot.id } });
        await deployBotToVps({ bot: freshBot, supabase });
      } catch (err) {
        console.error(`[train/cloud/callback] Failed to redeploy bot ${bot.id} after retrain:`, err);
        const message = err instanceof Error ? err.message : "Failed to redeploy after retrain";
        await prisma.botConfiguration.update({
          where: { id: bot.id },
          data: { status: "ERROR", lastError: message },
        });
      }
    } else if (bot.status === "TRAINING") {
      // First-ever training for a bot that was never deployed — nothing to
      // resume, just clear the way for a manual "Deploy to Cloud" click.
      // Every bot starts (and returns to) paper trading by default.
      await prisma.botConfiguration.update({ where: { id: bot.id }, data: { status: "TRAINING_PAPER_TRADE" } });
    }
  } else if (finalStatus === "FAILED" && bot) {
    // Deliberately left paused (if it was UPDATING_MODEL) rather than
    // auto-resumed with the old model — a human should look at why the
    // retrain failed before this bot trades again. See lib/train-cloud.ts
    // for the same reasoning on the "couldn't even start" path.
    await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: { status: "ERROR", lastError: finalErrorMessage },
    });
  }

  if (job.hetznerServerId) {
    try {
      await deleteHetznerServer(job.hetznerServerId);
      await prisma.trainingJob.update({ where: { id: job.id }, data: { hetznerServerId: null } });
    } catch (err) {
      // Leave hetznerServerId set — the reaper cron (layer 3) will retry.
      console.error(`[train/cloud/callback] Failed to delete Hetzner server for job ${job.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
});
