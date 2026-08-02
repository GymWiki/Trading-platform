import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getTrades, type FreqtradeTrade } from "@/lib/freqtrade-client";
import { withErrorHandling } from "@/lib/api-handler";

const TRADE_LIMIT = 200;

export interface PnlPoint {
  date: string;
  cumulativeProfit: number;
}

// Portfolio-wide P&L: merges closed trades across every one of the user's
// deployed bots (not just one) into a single running-total line — the
// "wealth" curve a consumer dashboard leads with, distinct from
// GET /api/bots/[id]/trades which stays scoped to one bot for the
// Humanized Trade History feed. Best-effort per bot, same as
// POST /api/bots/panic: one unreachable VPS must never blank the whole
// chart for every other bot's contribution.
export const GET = withErrorHandling(async (_req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bots = await prisma.botConfiguration.findMany({
    where: { userId: user.id, deploymentStatus: "VPS_ACTIVE" },
  });

  const allTrades: FreqtradeTrade[] = [];
  await Promise.all(
    bots.map(async (bot) => {
      if (!bot.hetznerServerIp || !bot.apiServerUsername || !bot.apiServerPassword) return;
      try {
        const trades = await getTrades(
          { serverIp: bot.hetznerServerIp, username: bot.apiServerUsername, password: decrypt(bot.apiServerPassword) },
          TRADE_LIMIT,
        );
        allTrades.push(...trades);
      } catch (err) {
        // Skip this bot's contribution rather than failing the whole chart
        // — the same "one unreachable VPS never blocks everything else"
        // rule as POST /api/bots/panic.
        console.error(`[bots/pnl] Failed to fetch trades for bot ${bot.id}:`, err);
      }
    }),
  );

  const closed = allTrades
    .filter((t): t is FreqtradeTrade & { close_date: string; profit_abs: number } => !t.is_open && t.close_date !== null && t.profit_abs !== null)
    .sort((a, b) => new Date(a.close_date).getTime() - new Date(b.close_date).getTime());

  let cumulative = 0;
  const points: PnlPoint[] = closed.map((t) => {
    cumulative += t.profit_abs;
    return { date: t.close_date, cumulativeProfit: Math.round(cumulative * 100) / 100 };
  });

  return NextResponse.json({
    points,
    totalProfit: Math.round(cumulative * 100) / 100,
    hasData: points.length > 0,
  });
});
