import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getTrades } from "@/lib/freqtrade-client";
import { humanizeTrades } from "@/lib/trade-humanizer";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

const TRADE_LIMIT = 100;

// Humanized Trade History: proxies this bot's own freqtrade /trades
// endpoint and translates exit_reason ("roi", "stop_loss", ...) into plain
// language before it ever reaches the frontend — see lib/trade-humanizer.ts
// for the actual translation table. Reads live from the deployed instance
// rather than a local copy, so there's no risk of it drifting from what
// freqtrade itself actually did.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
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
  if (!bot.hetznerServerIp || !bot.apiServerUsername || !bot.apiServerPassword) {
    return NextResponse.json({ error: "Bot is nog niet gedeployed — geen trade-historie beschikbaar" }, { status: 409 });
  }

  try {
    const trades = await getTrades(
      { serverIp: bot.hetznerServerIp, username: bot.apiServerUsername, password: decrypt(bot.apiServerPassword) },
      TRADE_LIMIT,
    );
    return NextResponse.json({ trades: humanizeTrades(trades) });
  } catch (err) {
    console.error(`[bots/${bot.id}/trades] Failed to fetch trades:`, err);
    const message = err instanceof Error ? err.message : "Kon trade-historie niet ophalen";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
