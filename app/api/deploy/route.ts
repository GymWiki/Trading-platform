import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { assertCanTrade, BotBusyError } from "@/lib/bot-status";
import { deployBotToVps } from "@/lib/deploy-bot";

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
  // Never let a manual "Deploy" click start trading while a training run
  // (initial or a retrain) is in progress — see lib/bot-status.ts.
  try {
    assertCanTrade(bot.status, "deploy");
  } catch (err) {
    if (err instanceof BotBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
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

  try {
    const { bot: updatedBot, apiCredentials } = await deployBotToVps({ bot, supabase });
    return NextResponse.json({ requiresCheckout: false, bot: updatedBot, apiCredentials });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to provision VPS";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
