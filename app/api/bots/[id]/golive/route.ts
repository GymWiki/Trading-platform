import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { fetchFreeBalance } from "@/lib/ccxt-client";
import { assertCanTrade, BotBusyError } from "@/lib/bot-status";
import { deployBotToVps } from "@/lib/deploy-bot";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// "Je saldo op [Exchange] is te laag. Stort minimaal $50 om live te
// handelen." — matches the amount the GoLiveModal shows the user.
// Not exported: Next.js route files may only export handler functions
// (GET/POST/etc.) and a small set of special names, nothing else.
const MIN_LIVE_BALANCE_USD = 50;

const goLiveBodySchema = z.object({
  totalBudget: z.number().positive("totalBudget must be a positive number"),
  maxStakePercentage: z.number().min(10, "maxStakePercentage must be at least 10").max(100, "maxStakePercentage must be at most 100"),
});

async function loadOwnedBot(botId: string, userId: string) {
  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== userId) return null;
  return bot;
}

// Live balance check the "Activeer Live Trading" modal opens with —
// separate from POST below so the UI can show the number (and the
// too-low warning) before the user commits to anything.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await loadOwnedBot(params.id, user.id);
  if (!bot) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  if (bot.status !== "TRAINING_PAPER_TRADE" || bot.deploymentStatus !== "VPS_ACTIVE") {
    return NextResponse.json(
      { error: "Bot moet eerst gedeployed zijn en paper-traden voordat je live kan gaan" },
      { status: 409 },
    );
  }

  const connection = await prisma.exchangeConnection.findUnique({ where: { id: bot.exchangeConnectionId } });
  if (!connection) {
    return NextResponse.json({ error: "Het gekoppelde platform bestaat niet meer" }, { status: 404 });
  }

  try {
    const balance = await fetchFreeBalance(connection.exchangeName, decrypt(connection.apiKey), decrypt(connection.apiSecret));
    return NextResponse.json({
      exchangeName: connection.exchangeName,
      balance,
      minRequired: MIN_LIVE_BALANCE_USD,
      canGoLive: balance.amount >= MIN_LIVE_BALANCE_USD,
    });
  } catch (err) {
    console.error(`[bots/golive] Balance fetch failed for bot ${bot.id}:`, err);
    const message = err instanceof Error ? err.message : "Could not fetch balance";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});

// Clears Go Live: saves the real budget/stake settings, flips
// isPaperTrading to false, and redeploys (Hetzner has no in-place config
// update — see lib/deploy-bot.ts — so "restart with dry_run: false" means
// delete-and-recreate the server, same as every other redeploy in this app).
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await loadOwnedBot(params.id, user.id);
  if (!bot) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  try {
    assertCanTrade(bot.status, "go live");
  } catch (err) {
    if (err instanceof BotBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
  if (bot.status !== "TRAINING_PAPER_TRADE" || bot.deploymentStatus !== "VPS_ACTIVE") {
    return NextResponse.json(
      { error: "Bot moet eerst gedeployed zijn en paper-traden voordat je live kan gaan" },
      { status: 409 },
    );
  }

  const parsed = await parseJsonBody(req, goLiveBodySchema);
  if ("error" in parsed) return parsed.error;
  const { totalBudget, maxStakePercentage } = parsed.data;

  const connection = await prisma.exchangeConnection.findUnique({ where: { id: bot.exchangeConnectionId } });
  if (!connection) {
    return NextResponse.json({ error: "Het gekoppelde platform bestaat niet meer" }, { status: 404 });
  }

  // Never trust a client-only balance check for a real-money gate —
  // re-verify live, right before committing, and also refuse to let the
  // user commit more budget than they actually have.
  let balanceAmount: number;
  try {
    const balance = await fetchFreeBalance(connection.exchangeName, decrypt(connection.apiKey), decrypt(connection.apiSecret));
    balanceAmount = balance.amount;
  } catch (err) {
    console.error(`[bots/golive] Balance fetch failed for bot ${bot.id}:`, err);
    const message = err instanceof Error ? err.message : "Could not fetch balance";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (balanceAmount < MIN_LIVE_BALANCE_USD) {
    return NextResponse.json(
      { error: `Je saldo op ${connection.exchangeName} is te laag. Stort minimaal $${MIN_LIVE_BALANCE_USD} om live te handelen.` },
      { status: 409 },
    );
  }
  if (totalBudget > balanceAmount) {
    return NextResponse.json(
      { error: `Budget ($${totalBudget}) is hoger dan je beschikbare saldo ($${balanceAmount.toFixed(2)}).` },
      { status: 409 },
    );
  }

  await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: { totalBudget, maxStakePercentage, isPaperTrading: false },
  });

  try {
    const freshBot = await prisma.botConfiguration.findUniqueOrThrow({ where: { id: bot.id } });
    await deployBotToVps({ bot: freshBot, supabase });
  } catch (err) {
    console.error(`[bots/golive] Failed to redeploy bot ${bot.id} live:`, err);
    const message = err instanceof Error ? err.message : "Failed to go live";
    await prisma.botConfiguration.update({ where: { id: bot.id }, data: { status: "ERROR", lastError: message } });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.botConfiguration.findUniqueOrThrow({ where: { id: bot.id }, select: botSelect });
  return NextResponse.json({ bot: toBotDTO(updated) });
});
