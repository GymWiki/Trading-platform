import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

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
    select: {
      id: true,
      botName: true,
      exchangeName: true,
      strategy: true,
      pairWhitelist: true,
      stakeAmount: true,
      isPaperTrading: true,
      deploymentStatus: true,
      aiModelPath: true,
      hetznerServerIp: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ bots });
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
    !pairWhitelist ||
    typeof stakeAmount !== "number"
  ) {
    return NextResponse.json({ error: "Missing required bot configuration fields" }, { status: 400 });
  }

  const bot = await prisma.botConfiguration.create({
    data: {
      userId: user.id,
      botName,
      exchangeName,
      exchangeApiKey: encrypt(exchangeApiKey),
      exchangeApiSecret: encrypt(exchangeApiSecret),
      strategy,
      pairWhitelist,
      stakeAmount,
      isPaperTrading: isPaperTrading ?? true,
      deploymentStatus: "LOCAL",
    },
    select: {
      id: true,
      botName: true,
      exchangeName: true,
      strategy: true,
      pairWhitelist: true,
      stakeAmount: true,
      isPaperTrading: true,
      deploymentStatus: true,
      aiModelPath: true,
      hetznerServerIp: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ bot }, { status: 201 });
}
