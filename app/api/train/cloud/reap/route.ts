import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";

// A TRAINING job older than this has blown well past the cloud-init
// script's own `timeout ... 4h` ceiling (see lib/hetzner.ts maxRuntimeHours)
// plus its grace period — at this point the VM's self-destruct trap should
// already have fired, so something has gone wrong and we force cleanup.
const STALE_TRAINING_HOURS = 5;

// Failsafe layer 3 of 3: catches whatever layers 1 (the VM's own trap) and 2
// (the callback route's redundant delete) missed — e.g. a hard VM crash
// that never ran any shutdown code at all. Wire this up with Vercel Cron
// (see vercel.json) hitting it every 15 minutes, authenticated via
// CRON_SECRET (Vercel sends `Authorization: Bearer $CRON_SECRET`
// automatically once that env var is set).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleCutoff = new Date(Date.now() - STALE_TRAINING_HOURS * 60 * 60 * 1000);

  const orphans = await prisma.trainingJob.findMany({
    where: {
      hetznerServerId: { not: null },
      OR: [
        { status: "TRAINING", updatedAt: { lt: staleCutoff } },
        { status: { in: ["COMPLETED", "FAILED"] } },
      ],
    },
  });

  const results: Array<{ jobId: string; serverId: string; ok: boolean }> = [];

  for (const job of orphans) {
    if (!job.hetznerServerId) continue;
    try {
      await deleteHetznerServer(job.hetznerServerId);
      await prisma.trainingJob.update({
        where: { id: job.id },
        data: {
          hetznerServerId: null,
          status: job.status === "TRAINING" ? "FAILED" : job.status,
          errorMessage: job.status === "TRAINING" ? "Reaped: exceeded max training runtime" : job.errorMessage,
        },
      });
      results.push({ jobId: job.id, serverId: job.hetznerServerId, ok: true });
    } catch {
      results.push({ jobId: job.id, serverId: job.hetznerServerId, ok: false });
    }
  }

  return NextResponse.json({ reaped: results.length, results });
}
