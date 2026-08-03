import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import {
  isSafePythonIdentifier,
  strategyCodeDefinesClass,
  isValidFreqAIConfig,
  MAX_STRATEGY_CODE_LENGTH,
} from "@/lib/strategy-validation";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// Closed list, not free text — matches the exchange picker in
// components/NewBotDialog.tsx exactly, same boundary EXCHANGE_PRESETS
// already enforced for the old exchangeConnectionId flow.
const exchangeIds = EXCHANGE_PRESETS.map((e) => e.id);

// freqaiConfig's exact shape is validated separately by isValidFreqAIConfig
// (see lib/strategy-validation.ts) — Zod only needs to confirm it's an
// object here, not re-encode every nested field as a second schema.
const createBotBodySchema = z.object({
  botName: z.string().trim().min(1, "botName is required"),
  // No connection required at creation — training and paper trading only
  // ever need this exchange's public market data (see lib/deploy-bot.ts,
  // lib/hetzner.ts). A real, verified account is only required later, at
  // the Go Live gate (app/api/bots/[id]/golive).
  exchangeName: z.string().refine((v) => exchangeIds.includes(v), { message: "exchangeName is not a supported exchange" }),
  strategy: z.string().min(1, "strategy is required"),
  strategyCode: z.string().min(1, "strategyCode is required"),
  freqaiConfig: z.record(z.string(), z.unknown()),
  autoSelectCoins: z.boolean().optional(),
  pairWhitelist: z.string().optional(),
});

export const GET = withErrorHandling(async () => {
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
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, createBotBodySchema);
  if ("error" in parsed) return parsed.error;
  const { botName, exchangeName, strategy, strategyCode, freqaiConfig, autoSelectCoins, pairWhitelist } = parsed.data;

  // Defaults to on (matches BotConfiguration.autoSelectCoins @default(true))
  // — an explicit false is the only way to require a manual whitelist.
  const autoSelect = autoSelectCoins !== false;
  // pairWhitelist is only meaningful — and only required — in manual mode;
  // in auto mode it's ignored and stored as null (lib/hetzner.ts configures
  // VolumePairList instead, see FreqAIProfileConfig-adjacent pairlist logic).
  if (!autoSelect && (!pairWhitelist || pairWhitelist.trim().length === 0)) {
    return NextResponse.json(
      { error: "pairWhitelist is required when auto-select is off — pick at least one pair" },
      { status: 400 },
    );
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
  if (strategyCode.length > MAX_STRATEGY_CODE_LENGTH) {
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

  // "Try before you risk": every bot is created in paper trading, with no
  // budget at stake — totalBudget/maxStakePercentage stay null until the
  // user clears the Go Live flow (see app/api/bots/[id]/golive). There is
  // deliberately no way to pass those in, or to skip straight to live, at
  // creation time.
  const bot = await prisma.botConfiguration.create({
    data: {
      userId: user.id,
      botName,
      exchangeName,
      strategy,
      strategyCode,
      freqaiConfig: freqaiConfig as Prisma.InputJsonValue,
      autoSelectCoins: autoSelect,
      pairWhitelist: autoSelect ? null : pairWhitelist,
      isPaperTrading: true,
      deploymentStatus: "LOCAL",
    },
    select: botSelect,
  });

  return NextResponse.json({ bot: toBotDTO(bot) }, { status: 201 });
});
