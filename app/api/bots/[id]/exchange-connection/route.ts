import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { fetchFreeBalance, BalanceFetchError } from "@/lib/ccxt-client";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import { exchangeConnectionSelect, toExchangeConnectionDTO } from "@/lib/exchange-connection-select";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// Closed list, not free text — same boundary app/api/bots/route.ts used to
// enforce back when the exchange was chosen at bot-creation time.
const exchangeIds = EXCHANGE_PRESETS.map((e) => e.id);

const connectBodySchema = z.object({
  apiKey: z.string().trim().min(1, "apiKey is required"),
  apiSecret: z.string().trim().min(1, "apiSecret is required"),
  // Only required the first time — a bot with no exchange chosen yet (see
  // Bot.exchangeName in prisma/schema.prisma). Once set, it's immutable:
  // ignored here on every later "Vervang" (replace-credentials) call, which
  // always keeps using the bot's own already-fixed exchange.
  exchangeName: z.string().optional(),
});

async function loadOwnedBot(botId: string, userId: string) {
  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== userId) return null;
  return bot;
}

// Connects (or replaces) this bot's own exchange account — part of the
// per-bot model in prisma/schema.prisma (ExchangeConnection.botId is
// unique: one connection per bot, never shared). Deliberately not saved
// until fetchFreeBalance actually succeeds with these exact credentials:
// a typo'd key would otherwise sit in the database looking connected
// until the Go Live balance check failed much later.
//
// This is also where a bot's exchange gets chosen now (bot.exchangeName is
// null until the first successful connect — see prisma/schema.prisma) —
// once set, it's immutable, same as before, so a later "Vervang" call
// always keeps using it regardless of what's in the request body.
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

  const parsed = await parseJsonBody(req, connectBodySchema);
  if ("error" in parsed) return parsed.error;
  const { apiKey, apiSecret, exchangeName: requestedExchangeName } = parsed.data;

  let exchangeName = bot.exchangeName;
  if (!exchangeName) {
    if (!requestedExchangeName || !exchangeIds.includes(requestedExchangeName)) {
      return NextResponse.json({ error: "exchangeName is required and must be a supported exchange" }, { status: 400 });
    }
    exchangeName = requestedExchangeName;
  }

  let balance;
  try {
    balance = await fetchFreeBalance(exchangeName, apiKey, apiSecret);
  } catch (err) {
    const message = err instanceof BalanceFetchError || err instanceof Error ? err.message : "Could not verify credentials";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Sets bot.exchangeName alongside the connection on a first-ever connect
  // (a no-op update when it's already set) — both succeed together or not
  // at all, so a bot can never end up with a verified connection but no
  // exchangeName of its own.
  const [, connection] = await prisma.$transaction([
    prisma.botConfiguration.update({
      where: { id: bot.id },
      data: { exchangeName },
    }),
    prisma.exchangeConnection.upsert({
      where: { botId: bot.id },
      create: {
        userId: user.id,
        botId: bot.id,
        exchangeName,
        apiKey: encrypt(apiKey),
        apiSecret: encrypt(apiSecret),
        verified: true,
      },
      update: {
        apiKey: encrypt(apiKey),
        apiSecret: encrypt(apiSecret),
        verified: true,
        isActive: true,
      },
      select: exchangeConnectionSelect,
    }),
  ]);

  return NextResponse.json({ connection: toExchangeConnectionDTO(connection), balance });
});

// Unlinks this bot's exchange account. Refused while the bot is actually
// live — disconnecting mid-trade would leave a running deployment unable
// to re-authenticate on its next redeploy with no obvious warning to the
// user until something failed later.
export const DELETE = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
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
  if (!bot.isPaperTrading) {
    return NextResponse.json(
      { error: "Kan het exchange-account niet ontkoppelen terwijl deze bot live handelt. Zet de bot eerst terug naar paper trading." },
      { status: 409 },
    );
  }

  await prisma.exchangeConnection.deleteMany({ where: { botId: bot.id, userId: user.id } });
  return NextResponse.json({ success: true });
});
