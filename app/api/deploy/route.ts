import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { decrypt } from "@/lib/encryption";
import { buildFreqtradeCloudInit, createHetznerServer } from "@/lib/hetzner";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { botId } = await req.json();
  if (typeof botId !== "string" || !botId) {
    return NextResponse.json({ error: "botId is required" }, { status: 400 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== session.user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  if (bot.deploymentStatus === "VPS_ACTIVE") {
    return NextResponse.json({ error: "Bot is already deployed" }, { status: 409 });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  const activeVpsBots = await prisma.botConfiguration.count({
    where: { userId: user.id, deploymentStatus: "VPS_ACTIVE" },
  });

  // Not enough quota purchased — send the user to Stripe Checkout to bump
  // the quantity on their per-bot subscription before we provision anything.
  if (activeVpsBots >= user.vpsBotQuota) {
    const priceId = process.env.STRIPE_VPS_BOT_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: "Billing is not configured" }, { status: 500 });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      customer: user.stripeCustomerId ?? undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email ?? undefined,
      line_items: [{ price: priceId, quantity: activeVpsBots + 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=cancelled`,
      metadata: { userId: user.id },
    });

    return NextResponse.json({ requiresCheckout: true, checkoutUrl: checkoutSession.url });
  }

  if (!bot.aiModelPath) {
    return NextResponse.json(
      { error: "Upload a trained .joblib model before deploying" },
      { status: 400 },
    );
  }

  const cloudInit = buildFreqtradeCloudInit({
    botName: bot.botName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    exchangeName: bot.exchangeName,
    exchangeApiKey: decrypt(bot.exchangeApiKey),
    exchangeApiSecret: decrypt(bot.exchangeApiSecret),
    strategy: bot.strategy,
    pairWhitelist: bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean),
    stakeAmount: bot.stakeAmount,
    isPaperTrading: bot.isPaperTrading,
    aiModelDownloadUrl: `${process.env.NEXT_PUBLIC_APP_URL}${bot.aiModelPath}`,
  });

  try {
    const { server } = await createHetznerServer({
      name: `bot-${bot.id}`,
      cloudInit,
    });

    const updated = await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: {
        deploymentStatus: "VPS_ACTIVE",
        hetznerServerId: String(server.id),
        hetznerServerIp: server.public_net?.ipv4?.ip ?? null,
      },
    });

    return NextResponse.json({ requiresCheckout: false, bot: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to provision VPS";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
