import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { startBot, type FreqtradeCredentials } from "@/lib/freqtrade-client";
import { deployBotToVps } from "@/lib/deploy-bot";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// The only way PAUSED_EMERGENCY (Panic Button), SLEEPING (Sleep Mode), or
// PAUSED_MANUAL (per-bot Stop, POST /api/bots/[id]/stop) is ever cleared —
// see lib/bot-status.ts, which blocks every other code path from doing it
// silently.
export const POST = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: params.id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  // PAUSED_MANUAL never touched the VPS — POST .../stop only halted the
  // freqtrade trading loop via its own REST API (see that route), so this
  // is the exact same call in reverse, not a full redeploy. Lighter and
  // faster than the PAUSED_EMERGENCY/SLEEPING path below, and correct:
  // there is nothing to recreate, the container never stopped running.
  if (bot.status === "PAUSED_MANUAL") {
    if (bot.deploymentStatus !== "VPS_ACTIVE" || !bot.hetznerServerIp || !bot.apiServerUsername || !bot.apiServerPassword) {
      return NextResponse.json({ error: "No reachable API credentials for this bot's server" }, { status: 409 });
    }
    const creds: FreqtradeCredentials = {
      serverIp: bot.hetznerServerIp,
      username: bot.apiServerUsername,
      password: decrypt(bot.apiServerPassword),
    };
    try {
      await startBot(creds);
    } catch (err) {
      console.error(`[bots/${bot.id}/resume] Failed to restart trading loop:`, err);
      const message = err instanceof Error ? err.message : "Could not reach the bot's server";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    const updated = await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: { status: bot.isPaperTrading ? "TRAINING_PAPER_TRADE" : "LIVE_TRADING" },
      select: botSelect,
    });
    return NextResponse.json({ bot: toBotDTO(updated) });
  }

  // Hetzner has no in-place "resume" for a stopped container any more
  // than it has an in-place config update (see lib/deploy-bot.ts docs), so
  // PAUSED_EMERGENCY/SLEEPING redeploy from scratch — the exact same
  // delete-and-recreate primitive every other resume path in this app
  // already uses, which is why it also works uniformly for a SLEEPING bot
  // whose VPS was merely powered off rather than deleted.
  if (bot.status !== "PAUSED_EMERGENCY" && bot.status !== "SLEEPING") {
    return NextResponse.json(
      { error: `Bot is ${bot.status}, niet gepauzeerd — er is niets om te hervatten` },
      { status: 409 },
    );
  }
  if (!bot.aiModelPath) {
    return NextResponse.json({ error: "Geen getraind model gevonden om mee te hervatten" }, { status: 409 });
  }

  try {
    const { bot: updated } = await deployBotToVps({ bot, supabase });
    return NextResponse.json({ bot: updated });
  } catch (err) {
    console.error(`[bots/${bot.id}/resume] Failed to redeploy:`, err);
    const message = err instanceof Error ? err.message : "Failed to resume";
    await prisma.botConfiguration.update({ where: { id: bot.id }, data: { status: "ERROR", lastError: message } });
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
