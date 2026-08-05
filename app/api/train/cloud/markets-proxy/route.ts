import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { fetchTopVolumeStakePairs, MarketDataError } from "@/lib/market-data-client";
import { AUTO_PAIRLIST_SIZE } from "@/lib/hetzner";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";
// A cold ccxt loadMarkets() + fetchTickers() call (plus a possible
// fallback-exchange retry) can comfortably exceed a 10s default Vercel
// timeout.
export const maxDuration = 30;

// Resolves the same top-N-by-volume pairlist a live auto-select bot's
// VolumePairList would hand to FreqAI (see buildPairlistConfig in
// lib/hetzner.ts, and AUTO_PAIRLIST_SIZE's own doc comment for why this
// used to return every active pair on the exchange instead — that turned
// out to mean thousands of files/requests for one bot in practice) —
// needed here so the client-side pre-fetch orchestrator
// (lib/client-data-download.ts / lib/background-fetch-download.ts) knows
// which pairs to fetch candles for *before* any VM exists. A direct
// browser call to the exchange's own markets/tickers endpoints is blocked
// by CORS (see lib/market-data-client.ts's own doc comment), hence this
// one-hop server-side proxy. Only ever reads a botId to confirm the caller
// is authenticated and owns *some* bot — the actual result is
// exchange-wide, not bot-specific, so there is nothing per-bot to leak.
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
    const { data: pairs, source } = await fetchTopVolumeStakePairs(AUTO_PAIRLIST_SIZE);
    return NextResponse.json({ pairs, source });
  } catch (err) {
    const message = err instanceof MarketDataError || err instanceof Error ? err.message : "Could not fetch market list";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
