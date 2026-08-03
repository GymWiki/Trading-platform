import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// Stripe requires the raw request body to verify the webhook signature,
// so this route must not run through any body-parsing middleware.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      if (userId && typeof session.customer === "string") {
        await prisma.profile.update({
          where: { id: userId },
          data: {
            stripeCustomerId: session.customer,
            stripeSubscriptionId:
              typeof session.subscription === "string" ? session.subscription : undefined,
          },
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const quantity = subscription.items.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      const isActive = subscription.status === "active" || subscription.status === "trialing";

      await prisma.profile.updateMany({
        where: { stripeCustomerId: subscription.customer as string },
        data: {
          stripeSubscriptionId: subscription.id,
          vpsBotQuota: isActive ? quantity : 0,
        },
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await prisma.profile.updateMany({
        where: { stripeCustomerId: subscription.customer as string },
        data: { vpsBotQuota: 0 },
      });
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
});
