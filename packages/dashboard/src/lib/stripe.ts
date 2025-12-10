import Stripe from "stripe";

// Lazy initialization to avoid build-time errors when env vars aren't set
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-11-17.clover",
      typescript: true,
    });
  }
  return stripeClient;
}

// Map tier IDs to Stripe price IDs
// These should be updated with your actual Stripe price IDs
export const STRIPE_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || "",
  pro: process.env.STRIPE_PRICE_PRO || "",
  // Enterprise is handled differently (contact sales)
};

// Map Stripe price IDs back to tier IDs
export function getTierIdFromPriceId(priceId: string): string | null {
  for (const [tierId, stripePriceId] of Object.entries(STRIPE_PRICE_IDS)) {
    if (stripePriceId === priceId) {
      return tierId;
    }
  }
  return null;
}
