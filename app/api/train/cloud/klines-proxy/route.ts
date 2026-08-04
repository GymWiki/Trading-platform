import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { fetchOhlcvPage, MarketDataError } from "@/lib/market-data-client";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// One page of candles per call — see lib/market-data-client.ts's own doc
// comment for why this proxy exists at all (CORS). The client-side
// pre-fetch orchestrator (lib/client-data-download.ts) calls this
// repeatedly per pair/timeframe, paging forward with `since` until it gets
// back fewer than `limit` candles (or none), same end-of-data signal any
// paginated OHLCV fetch uses. Capped well below what a single exchange
// call would ever return, keeping each request small and fast rather than
// trying to fetch a whole pair's multi-month history in one call.
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 300;

const querySchema = z.object({
  botId: z.string().min(1),
  pair: z.string().min(1),
  timeframe: z.string().min(1),
  since: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

export const GET = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query parameters" }, { status: 400 });
  }
  const { botId, pair, timeframe, since, limit = DEFAULT_LIMIT } = parsed.data;

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId }, select: { userId: true } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  try {
    const {
      data: { candles },
      source,
    } = await fetchOhlcvPage(pair, timeframe, since, limit);
    return NextResponse.json({ candles, source });
  } catch (err) {
    const message = err instanceof MarketDataError || err instanceof Error ? err.message : "Could not fetch candles";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
