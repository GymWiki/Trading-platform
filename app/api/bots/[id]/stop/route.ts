import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { stopBot, type FreqtradeCredentials } from "@/lib/freqtrade-client";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// Per-bot Stop: pauses just THIS bot, independent of every other bot —
// unlike POST /api/bots/panic (the global kill switch), this never
// force-closes open positions. It halts new entries the exact same way
// the Panic Button does (stopBot(), freqtrade's own /stop, called with
// this bot's own per-deployment credentials) so there is one single code
// path for "safely halt a running freqtrade loop" that both features
// share, rather than two that could drift out of sync.
//
// Open positions are deliberately left exactly as they are: the freqtrade
// process (and its API) keeps running, so existing trades are still
// monitored and exited by their own stoploss/exit logic — only opening
// *new* trades is blocked. A user who also wants existing positions
// force-closed already has the Panic Button for that; this is the
// lighter, reversible "pause just this bot" action. See PAUSED_MANUAL in
// prisma/schema.prisma for the full state-machine writeup.
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

  if (bot.deploymentStatus !== "VPS_ACTIVE") {
    return NextResponse.json({ error: "Bot draait niet op een server — er is niets om te stoppen" }, { status: 409 });
  }
  if (bot.status !== "TRAINING_PAPER_TRADE" && bot.status !== "LIVE_TRADING") {
    return NextResponse.json({ error: `Bot is ${bot.status} — er is niets actiefs om te stoppen` }, { status: 409 });
  }
  if (!bot.hetznerServerIp || !bot.apiServerUsername || !bot.apiServerPassword) {
    return NextResponse.json({ error: "No reachable API credentials for this bot's server" }, { status: 409 });
  }

  const creds: FreqtradeCredentials = {
    serverIp: bot.hetznerServerIp,
    username: bot.apiServerUsername,
    password: decrypt(bot.apiServerPassword),
  };

  try {
    await stopBot(creds);
  } catch (err) {
    console.error(`[bots/${bot.id}/stop] Failed to stop trading loop:`, err);
    const message = err instanceof Error ? err.message : "Could not reach the bot's server";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Only flipped once stopBot() above actually succeeded — an unreachable
  // server must surface as an error, not a false "Gestopt" that leaves
  // the real trading loop running.
  const updated = await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: { status: "PAUSED_MANUAL", lastError: null },
    select: botSelect,
  });
  return NextResponse.json({ bot: toBotDTO(updated) });
});
