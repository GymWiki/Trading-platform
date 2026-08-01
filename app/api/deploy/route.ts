import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { decrypt, encrypt } from "@/lib/encryption";
import { buildFreqtradeCloudInit, createHetznerServer } from "@/lib/hetzner";
import { botSelect, toBotDTO } from "@/lib/bot-select";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { botId } = await req.json();
  if (typeof botId !== "string" || !botId) {
    return NextResponse.json({ error: "botId is required" }, { status: 400 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== authUser.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  if (bot.deploymentStatus === "VPS_ACTIVE") {
    return NextResponse.json({ error: "Bot is already deployed" }, { status: 409 });
  }

  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: authUser.id } });
  const activeVpsBots = await prisma.botConfiguration.count({
    where: { userId: profile.id, deploymentStatus: "VPS_ACTIVE" },
  });

  // Not enough quota purchased — send the user to Stripe Checkout to bump
  // the quantity on their per-bot subscription before we provision anything.
  if (activeVpsBots >= profile.vpsBotQuota) {
    const priceId = process.env.STRIPE_VPS_BOT_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: "Billing is not configured" }, { status: 500 });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: profile.id,
      customer: profile.stripeCustomerId ?? undefined,
      customer_email: profile.stripeCustomerId ? undefined : authUser.email,
      line_items: [{ price: priceId, quantity: activeVpsBots + 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=cancelled`,
      metadata: { userId: profile.id },
    });

    return NextResponse.json({ requiresCheckout: true, checkoutUrl: checkoutSession.url });
  }

  if (!bot.aiModelPath) {
    return NextResponse.json(
      { error: "Upload a trained .joblib model before deploying" },
      { status: 400 },
    );
  }

  // The "models" bucket is private, so the Hetzner VPS (which has no
  // Supabase session) needs a short-lived signed URL to fetch the file
  // during cloud-init — long enough for boot + Docker pull + download.
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("models")
    .createSignedUrl(bot.aiModelPath, 3600);
  if (signedUrlError || !signedUrlData) {
    return NextResponse.json(
      { error: `Failed to create a download URL for the model: ${signedUrlError?.message}` },
      { status: 502 },
    );
  }

  // Randomized per deployment — every previous version of this route baked
  // in a literal "CHANGE_ME_ON_DEPLOY" password, meaning every deployed bot
  // exposed the same known credentials on its public REST API.
  const apiServerUsername = `freqtrader-${crypto.randomBytes(4).toString("hex")}`;
  const apiServerPassword = crypto.randomBytes(24).toString("base64url");
  const apiServerJwtSecret = crypto.randomBytes(32).toString("hex");

  const cloudInit = buildFreqtradeCloudInit({
    botName: bot.botName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    exchangeName: bot.exchangeName,
    exchangeApiKey: decrypt(bot.exchangeApiKey),
    exchangeApiSecret: decrypt(bot.exchangeApiSecret),
    strategy: bot.strategy,
    strategyCode: bot.strategyCode,
    pairWhitelist: bot.pairWhitelist.split(",").map((p) => p.trim()).filter(Boolean),
    stakeAmount: bot.stakeAmount,
    isPaperTrading: bot.isPaperTrading,
    aiModelDownloadUrl: signedUrlData.signedUrl,
    apiServerUsername,
    apiServerPassword,
    apiServerJwtSecret,
  });

  try {
    const { server } = await createHetznerServer({
      name: `bot-${bot.id}`,
      cloudInit,
      firewallProfile: "live-trading",
    });

    const updated = await prisma.botConfiguration.update({
      where: { id: bot.id },
      data: {
        deploymentStatus: "VPS_ACTIVE",
        hetznerServerId: String(server.id),
        hetznerServerIp: server.public_net?.ipv4?.ip ?? null,
        apiServerUsername,
        apiServerPassword: encrypt(apiServerPassword),
        apiServerJwtSecret: encrypt(apiServerJwtSecret),
      },
      select: botSelect,
    });

    return NextResponse.json({
      requiresCheckout: false,
      bot: toBotDTO(updated),
      // Only ever sent in this one response — see GET /api/bots/[id]/credentials to view again later.
      apiCredentials: { username: apiServerUsername, password: apiServerPassword },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to provision VPS";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
