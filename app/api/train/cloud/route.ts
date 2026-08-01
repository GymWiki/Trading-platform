import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { buildFreqAITrainingCloudInit, createHetznerServer } from "@/lib/hetzner";
import { generateCallbackToken, hashCallbackToken } from "@/lib/training-token";

const TRAINING_SERVER_TYPE = process.env.HETZNER_TRAINING_SERVER_TYPE || "cpx31";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { botId } = await req.json();
  if (typeof botId !== "string" || !botId) {
    return NextResponse.json({ error: "botId is required" }, { status: 400 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  // Cost-safety guard: never let a second cloud VM spin up for a bot that
  // already has one training. This is the cheapest possible protection
  // against runaway Hetzner spend from a double-click or retried request.
  const activeJob = await prisma.trainingJob.findFirst({
    where: { botId: bot.id, status: { in: ["QUEUED", "TRAINING"] } },
  });
  if (activeJob) {
    return NextResponse.json({ error: "A training job is already running for this bot" }, { status: 409 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured" }, { status: 500 });
  }
  const hetznerApiToken = process.env.HETZNER_API_TOKEN;
  if (!hetznerApiToken) {
    // Refuse to boot a VM that couldn't delete itself — this token is what
    // makes the self-destruct failsafe possible at all.
    return NextResponse.json({ error: "HETZNER_API_TOKEN is not configured" }, { status: 500 });
  }

  const callbackToken = generateCallbackToken();

  const job = await prisma.trainingJob.create({
    data: {
      botId: bot.id,
      userId: user.id,
      mode: "CLOUD",
      status: "QUEUED",
      callbackTokenHash: hashCallbackToken(callbackToken),
    },
  });

  try {
    const cloudInit = buildFreqAITrainingCloudInit({
      botName: bot.botName,
      exchangeName: bot.exchangeName,
      strategy: bot.strategy,
      strategyCode: bot.strategyCode,
      pairWhitelist: bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean),
      uploadUrlEndpoint: `${appUrl}/api/train/cloud/upload-url`,
      callbackUrl: `${appUrl}/api/train/cloud/callback`,
      callbackToken,
      hetznerApiToken,
    });

    const { server } = await createHetznerServer({
      name: `train-${job.id}`,
      cloudInit,
      serverType: TRAINING_SERVER_TYPE,
      firewallProfile: "training",
    });

    const updatedJob = await prisma.trainingJob.update({
      where: { id: job.id },
      data: { status: "TRAINING", hetznerServerId: String(server.id) },
    });

    await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: { trainingMode: "CLOUD" },
    });

    return NextResponse.json({ job: updatedJob }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start cloud training";
    await prisma.trainingJob.update({
      where: { id: job.id },
      data: { status: "FAILED", errorMessage: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
