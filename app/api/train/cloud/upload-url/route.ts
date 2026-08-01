import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerComponentClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { extractBearerToken, hashCallbackToken } from "@/lib/training-token";

const MODELS_BUCKET = "models";

// Called by the ephemeral training VM (no user session — authenticated via
// the job's one-time bearer token) right before it uploads its result, so
// the signed URL is always freshly minted regardless of how long training
// took.
//
// Uses the service-role key, not the anon key: the VM presents no user JWT,
// so `auth.uid()` would be NULL and the storage.objects RLS insert policy
// would reject the mint. That's safe here because the object path is
// computed entirely from our own trusted job record (job.userId/job.botId),
// never from caller input — the bearer token only ever unlocks the one path
// that job was created for.
export async function GET(req: NextRequest) {
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
  if (job.status !== "TRAINING" && job.status !== "QUEUED") {
    return NextResponse.json({ error: "Job is no longer active" }, { status: 409 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 500 });
  }

  const objectPath = `${job.userId}/${job.botId}/model-cloud-${job.id}.joblib`;

  const supabase = createServerComponentClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);
  const { data, error } = await supabase.storage.from(MODELS_BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) {
    return NextResponse.json({ error: `Could not create upload URL: ${error?.message}` }, { status: 502 });
  }

  // Record the path now so the callback route trusts our own record of
  // where the file went rather than whatever the VM might claim.
  await prisma.trainingJob.update({ where: { id: job.id }, data: { aiModelPath: objectPath } });

  return NextResponse.json({ uploadUrl: data.signedUrl });
}
