import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import {
  isSafePythonIdentifier,
  strategyCodeDefinesClass,
  isValidFreqAIConfig,
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
    freqaiConfig,
    pairWhitelist,
    totalBudget,
    maxStakePercentage,
    isPaperTrading,
  } = body ?? {};

  if (
    !botName ||
    !exchangeName ||
    !exchangeApiKey ||
    !exchangeApiSecret ||
    !strategy ||
    !strategyCode ||
    !freqaiConfig ||
    !pairWhitelist ||
    typeof totalBudget !== "number" ||
    typeof maxStakePercentage !== "number"
  ) {
    return NextResponse.json({ error: "Missing required bot configuration fields" }, { status: 400 });
  }

  // Closed list, not free text (see lib/exchange-presets.ts) — exchangeName
  // becomes the ccxt exchange id in the generated config.json, so an
  // unsupported or misspelled value must be rejected here rather than
  // surface as a cryptic failure deep in a cloud-init run.
  if (!EXCHANGE_PRESETS.some((e) => e.id === exchangeName)) {
    return NextResponse.json({ error: "exchangeName is not a supported exchange" }, { status: 400 });
  }

  if (!(totalBudget > 0)) {
    return NextResponse.json({ error: "totalBudget must be a positive number" }, { status: 400 });
  }
  // Mirrors the UI slider's range (see components/ui/BudgetSlider.tsx) — the
  // hard cap custom_stake_amount enforces in the deployed strategy code is
  // only as trustworthy as the value we accept here.
  if (maxStakePercentage < 10 || maxStakePercentage > 100) {
    return NextResponse.json({ error: "maxStakePercentage must be between 10 and 100" }, { status: 400 });
  }

  // Every bot runs on FreqAI — this is the training/feature/risk config for
  // the chosen AI behavior (see lib/strategy-presets.ts), not optional
  // metadata. lib/hetzner.ts trusts its shape when generating config.json.
  if (!isValidFreqAIConfig(freqaiConfig)) {
    return NextResponse.json({ error: "freqaiConfig is missing required fields" }, { status: 400 });
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
      freqaiConfig,
      pairWhitelist,
      totalBudget,
      maxStakePercentage,
      isPaperTrading: isPaperTrading ?? true,
      deploymentStatus: "LOCAL",
    },
    select: botSelect,
  });

  return NextResponse.json({ bot: toBotDTO(bot) }, { status: 201 });
}
