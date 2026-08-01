import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, hashCallbackToken } from "@/lib/training-token";
import { deleteHetznerServer } from "@/lib/hetzner";

const MAX_ERROR_MESSAGE_LENGTH = 2000;

// Called once by the training VM when it finishes (successfully or not).
// This is failsafe layer 2 of 3: on top of the VM's own trap-based
// self-destruct (layer 1) and the /api/train/cloud/reap cron backstop
// (layer 3), we also attempt the delete here ourselves, using our own
// privileged HETZNER_API_TOKEN rather than the one embedded in cloud-init —
// redundant on purpose, in case the VM's own delete call fails.
export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => null);
  const status = body?.status;
  const rawErrorMessage = typeof body?.errorMessage === "string" ? body.errorMessage : null;
  const errorMessage = rawErrorMessage?.slice(0, MAX_ERROR_MESSAGE_LENGTH) ?? null;

  if (status !== "COMPLETED" && status !== "FAILED") {
    return NextResponse.json({ error: "status must be COMPLETED or FAILED" }, { status: 400 });
  }

  // A COMPLETED report with no recorded model path is a contradiction —
  // the upload-url route always sets aiModelPath before the VM could have
  // uploaded anything. Treat it as a failure rather than trust the claim.
  const finalStatus = status === "COMPLETED" && !job.aiModelPath ? "FAILED" : status;
  const finalErrorMessage =
    finalStatus === "FAILED" && !errorMessage && status === "COMPLETED"
      ? "Reported COMPLETED but no model path was ever recorded for this job"
      : errorMessage;

  await prisma.trainingJob.update({
    where: { id: job.id },
    data: { status: finalStatus, errorMessage: finalErrorMessage },
  });

  if (finalStatus === "COMPLETED" && job.aiModelPath) {
    await prisma.botConfiguration.update({
      where: { id: job.botId },
      data: { aiModelPath: job.aiModelPath },
    });
  }

  if (job.hetznerServerId) {
    try {
      await deleteHetznerServer(job.hetznerServerId);
      await prisma.trainingJob.update({ where: { id: job.id }, data: { hetznerServerId: null } });
    } catch {
      // Leave hetznerServerId set — the reaper cron (layer 3) will retry.
    }
  }

  return NextResponse.json({ ok: true });
}
