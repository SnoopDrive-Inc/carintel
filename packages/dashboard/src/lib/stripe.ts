import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
  typescript: true,
});

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
