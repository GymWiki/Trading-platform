import Stripe from "stripe";

// Lazily validated so builds don't require Stripe credentials — routes that
// actually call the Stripe API will fail at request time if this is unset.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder", {
  apiVersion: "2025-02-24.acacia",
});
