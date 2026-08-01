import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { startCloudTrainingJob, TrainingBusyError } from "@/lib/train-cloud";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const botId = body?.botId;
  const cancelOpenOrders = body?.cancelOpenOrders === true;
  if (typeof botId !== "string" || !botId) {
    return NextResponse.json({ error: "botId is required" }, { status: 400 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  try {
    // If the bot is currently TRADING, this genuinely pauses it via its own
    // freqtrade API first — training/updating always takes priority. See
    // lib/train-cloud.ts.
    const job = await startCloudTrainingJob({ bot, cancelOpenOrders });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (err instanceof TrainingBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Failed to start cloud training";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
