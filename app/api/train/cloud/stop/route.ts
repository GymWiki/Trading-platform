import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

const stopBodySchema = z.object({ jobId: z.string().uuid() });

const CANCELLED_REASON = "Training handmatig gestopt door gebruiker";

// User-initiated cancel for an in-flight Cloud Training job — the "Stop
// training" button in BotCard, shown whenever bot.latestTrainingJob is
// QUEUED/TRAINING. Distinct from GET /api/train/cloud/reap (the automatic
// staleness backstop) but reuses the exact same deleteHetznerServer() from
// lib/hetzner.ts, so there is one single implementation of "delete this
// training VM" rather than two that could drift apart. Also distinct from a
// training FAILURE: CANCELLED means the user asked for this, nothing broke.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, stopBodySchema);
  if ("error" in parsed) return parsed.error;

  const job = await prisma.trainingJob.findUnique({ where: { id: parsed.data.jobId } });
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: "Training job not found" }, { status: 404 });
  }

  // Idempotent: a double-click, a second tab, or the reap cron already
  // having cleaned this exact job up is a no-op success, not an error —
  // same guard shape as POST /api/train/cloud/progress and /callback.
  if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    const bot = await prisma.botConfiguration.findUniqueOrThrow({ where: { id: job.botId }, select: botSelect });
    return NextResponse.json({ bot: toBotDTO(bot) });
  }

  // Best-effort, not a hard requirement for success: the user's intent to
  // stop must always be recorded (same reasoning as the Panic Button, see
  // app/api/bots/panic) even if Hetzner itself is briefly unreachable.
  // hetznerServerId is only cleared once the delete actually succeeds — if
  // it didn't, it stays set so the reap cron's backstop still finds and
  // deletes the orphaned server later.
  let deleteError: string | null = null;
  if (job.hetznerServerId) {
    try {
      await deleteHetznerServer(job.hetznerServerId);
    } catch (err) {
      console.error(`[train/cloud/stop] Failed to delete Hetzner server for job ${job.id}:`, err);
      deleteError = err instanceof Error ? err.message : "Could not reach Hetzner to delete the training server";
    }
  }

  const errorMessage = deleteError
    ? `${CANCELLED_REASON} — kon de cloud-server niet meteen verwijderen, wordt automatisch opgeruimd (${deleteError})`
    : CANCELLED_REASON;

  await prisma.trainingJob.update({
    where: { id: job.id },
    data: {
      status: "CANCELLED",
      hetznerServerId: deleteError ? job.hetznerServerId : null,
      errorMessage,
    },
  });

  // Mirror the reap cron's own bot-status reset (see that route) — freeing
  // the bot out of TRAINING/UPDATING_MODEL is what actually lets the user
  // retry, not just marking the job itself CANCELLED.
  await prisma.botConfiguration.update({
    where: { id: job.botId },
    data: { status: "ERROR", lastError: errorMessage },
  });

  const bot = await prisma.botConfiguration.findUniqueOrThrow({ where: { id: job.botId }, select: botSelect });
  return NextResponse.json({ bot: toBotDTO(bot) });
});
