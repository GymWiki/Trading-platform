import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { startCloudTrainingJob, TrainingBusyError } from "@/lib/train-cloud";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

export const dynamic = "force-dynamic";
// startCloudTrainingJob's own try/catch (lib/train-cloud.ts) is what turns a
// slow/failing Hetzner call into a clean FAILED status instead of a job
// stuck at QUEUED forever — but that safety net only runs if the platform
// lets the function keep executing. hetznerFetch's own abort is 15s, and
// resolveServerLocation can make up to two of those sequential calls
// before the actual create call — comfortably over a 10s default Vercel
// timeout, which would kill the function (and skip the catch block
// entirely) before our own error handling ever gets a chance to run.
export const maxDuration = 60;

// uploadSessionId/preloadedFiles are set only by the client-side pre-fetch
// flow (see components/BotCard.tsx's handleStartCloudTraining and
// lib/client-data-download.ts): the browser fetches every pair/timeframe's
// candles itself (routed through /api/train/cloud/{markets,klines}-proxy —
// see those routes' own doc comments for why), uploads each one via
// POST /api/train/cloud/upload-data, and only calls this route — the one
// that actually provisions a VPS — after every upload has succeeded. That
// ordering is what satisfies "no half-created VPS if the client-side
// download fails or the page closes mid-way": nothing here ever runs
// until the browser itself decides the data is complete. preloadedFiles is
// the browser's own record of exactly which (pair, timeframe) files it
// uploaded — trusted only as far as which paths to look up in Storage;
// startCloudTrainingJob still mints (and can fail on) real signed URLs for
// each one rather than taking the browser's word that the data exists.
const startTrainingSchema = z
  .object({
    botId: z.string().min(1, "botId is required"),
    cancelOpenOrders: z.boolean().optional(),
    uploadSessionId: z.string().uuid().optional(),
    preloadedFiles: z
      .array(z.object({ pair: z.string().min(1), timeframe: z.string().min(1) }))
      .min(1)
      .optional(),
  })
  .refine((v) => !!v.uploadSessionId === !!v.preloadedFiles, {
    message: "uploadSessionId and preloadedFiles must be provided together",
  });

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, startTrainingSchema);
  if ("error" in parsed) return parsed.error;
  const { botId, cancelOpenOrders = false, uploadSessionId, preloadedFiles } = parsed.data;

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  try {
    // If the bot is currently deployed (paper or live), this genuinely
    // pauses it via its own freqtrade API first — training/updating always
    // takes priority. See lib/train-cloud.ts.
    const job = await startCloudTrainingJob({
      bot,
      cancelOpenOrders,
      preloadedData: uploadSessionId && preloadedFiles ? { uploadSessionId, files: preloadedFiles } : undefined,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (err instanceof TrainingBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(`[train/cloud] Failed to start cloud training for bot ${bot.id}:`, err);
    const message = err instanceof Error ? err.message : "Failed to start cloud training";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
