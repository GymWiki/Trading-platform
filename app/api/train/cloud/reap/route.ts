import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";
import { withErrorHandling } from "@/lib/api-handler";

// A TRAINING job older than this has blown well past the cloud-init
// script's own `timeout ... 4h` ceiling (see lib/hetzner.ts maxRuntimeHours)
// plus its grace period — at this point the VM's self-destruct trap should
// already have fired, so something has gone wrong and we force cleanup.
const STALE_TRAINING_HOURS = 5;

// Plain string comparison would leak timing information about how many
// leading characters of the presented token matched CRON_SECRET. This is
// hit over plain HTTP by an external scheduler (not Vercel's own signed
// cron mechanism), so treat the Authorization header like any other
// untrusted bearer token.
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// Failsafe layer 3 of 3: catches whatever layers 1 (the VM's own trap) and 2
// (the callback route's redundant delete) missed — e.g. a hard VM crash
// that never ran any shutdown code at all.
//
// Triggered by an external scheduler (e.g. cron-job.org) hitting this URL
// every ~15 minutes with an `Authorization: Bearer <CRON_SECRET>` header
// configured on the scheduler's side — deliberately not Vercel Cron, so
// this route makes no assumption about how the request was scheduled and
// only ever trusts a literal, exact bearer-token match.
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!isAuthorized(req)) {
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
});
