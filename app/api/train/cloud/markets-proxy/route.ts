import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { fetchTradableStakePairs, MarketDataError } from "@/lib/market-data-client";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";
// A cold ccxt loadMarkets() call (plus a possible fallback-exchange retry)
// can comfortably exceed a 10s default Vercel timeout.
export const maxDuration = 30;

// Resolves the same pairlist an auto-select bot's training VM would
// otherwise resolve for itself via freqtrade's own ".*/USDT" wildcard
// expansion (see buildPairlistConfig in lib/hetzner.ts) — needed here so
// the client-side pre-fetch orchestrator (lib/client-data-download.ts)
// knows which pairs to fetch candles for *before* any VM exists. A direct
// browser call to the exchange's own markets endpoint is blocked by CORS
// (see lib/market-data-client.ts's own doc comment), hence this one-hop
// server-side proxy. Only ever reads a botId to confirm the caller is
// authenticated and owns *some* bot — the actual result is exchange-wide,
// not bot-specific, so there is nothing per-bot to leak.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botId = req.nextUrl.searchParams.get("botId");
  if (!botId) {
    return NextResponse.json({ error: "botId query parameter is required" }, { status: 400 });
  }
  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId }, select: { userId: true } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  try {
    const { data: pairs, source } = await fetchTradableStakePairs();
    return NextResponse.json({ pairs, source });
  } catch (err) {
    const message = err instanceof MarketDataError || err instanceof Error ? err.message : "Could not fetch market list";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
