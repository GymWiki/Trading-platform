import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import {
  isSafePythonIdentifier,
  strategyCodeDefinesClass,
  MAX_STRATEGY_CODE_LENGTH,
} from "@/lib/strategy-validation";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bots = await prisma.botConfiguration.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: botSelect,
  });

  return NextResponse.json({ bots: bots.map(toBotDTO) });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    botName,
    exchangeName,
    exchangeApiKey,
    exchangeApiSecret,
    strategy,
    strategyCode,
    pairWhitelist,
    stakeAmount,
    isPaperTrading,
  } = body ?? {};

  if (
    !botName ||
    !exchangeName ||
    !exchangeApiKey ||
    !exchangeApiSecret ||
    !strategy ||
    !strategyCode ||
    !pairWhitelist ||
    typeof stakeAmount !== "number"
  ) {
    return NextResponse.json({ error: "Missing required bot configuration fields" }, { status: 400 });
  }

  // `strategy` becomes both a Python class name and a filename
  // (user_data/strategies/<strategy>.py) once this bot is ever deployed or
  // trained — reject it here, at the earliest boundary, rather than let a
  // bad value surface later as a cryptic cloud-init failure.
  if (!isSafePythonIdentifier(strategy)) {
    return NextResponse.json(
      { error: "strategy must be a valid Python identifier (letters, digits, underscore; can't start with a digit)" },
      { status: 400 },
    );
  }
  if (typeof strategyCode !== "string" || strategyCode.length > MAX_STRATEGY_CODE_LENGTH) {
    return NextResponse.json(
      { error: `strategyCode must be a string under ${MAX_STRATEGY_CODE_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (!strategyCodeDefinesClass(strategyCode, strategy)) {
    return NextResponse.json(
      { error: `strategyCode must define "class ${strategy}" — it doesn't seem to match the strategy name above` },
      { status: 400 },
    );
  }

  const bot = await prisma.botConfiguration.create({
    data: {
      userId: user.id,
      botName,
      exchangeName,
      exchangeApiKey: encrypt(exchangeApiKey),
      exchangeApiSecret: encrypt(exchangeApiSecret),
      strategy,
      strategyCode,
      pairWhitelist,
      stakeAmount,
      isPaperTrading: isPaperTrading ?? true,
      deploymentStatus: "LOCAL",
    },
    select: botSelect,
  });

  return NextResponse.json({ bot: toBotDTO(bot) }, { status: 201 });
}
