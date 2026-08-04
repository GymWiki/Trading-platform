import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";
import { pairToFreqtradeFilename } from "@/lib/freqtrade-format";

export const dynamic = "force-dynamic";

const MODELS_BUCKET = "models";

// One call per (pair, timeframe) file — the browser calls this once it has
// finished collecting that pair/timeframe's candles (see
// lib/client-data-download.ts), then PUTs the JSON directly to the
// returned signed URL, bypassing this route (and Vercel's own request-body
// limit) entirely for the actual data transfer. Mirrors
// GET /api/train/cloud/upload-url's signed-upload-URL pattern for the
// trained model file, except this one runs under the user's own session
// (there is no TrainingJob yet at this point — see POST /api/train/cloud's
// own doc comment for why provisioning only happens after every file here
// has uploaded successfully), so storage.objects' own INSERT policy
// (`(storage.foldername(name))[1] = auth.uid()`) is satisfied directly,
// no service-role key needed.
const bodySchema = z.object({
  botId: z.string().min(1),
  uploadSessionId: z.string().uuid(),
  pair: z.string().min(1),
  timeframe: z.string().min(1),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, bodySchema);
  if ("error" in parsed) return parsed.error;
  const { botId, uploadSessionId, pair, timeframe } = parsed.data;

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId }, select: { userId: true } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  const filename = `${pairToFreqtradeFilename(pair)}-${timeframe}.json`;
  const objectPath = `${user.id}/${botId}/training-data/${uploadSessionId}/${filename}`;

  const { data, error } = await supabase.storage.from(MODELS_BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) {
    return NextResponse.json({ error: `Could not create upload URL: ${error?.message}` }, { status: 502 });
  }

  return NextResponse.json({ uploadUrl: data.signedUrl, token: data.token, path: objectPath });
});
