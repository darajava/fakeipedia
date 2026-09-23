import Stripe from "stripe";

export class BillingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function billingConfig() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const articlePrice = process.env.STRIPE_ARTICLE_PRICE_ID;
  const packPrice = process.env.STRIPE_CREDIT_PACK_PRICE_ID;
  const packQuantity = Number(process.env.CREDIT_PACK_QUANTITY);
  const origin = process.env.APP_URL;
  if (process.env.BILLING_ENABLED !== "true" || !secret || !articlePrice || !packPrice ||
      !Number.isSafeInteger(packQuantity) || packQuantity < 1 || packQuantity > 10000 || !origin) {
    throw new BillingError("Payments are not available yet. Your answer has been saved.", 503);
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new BillingError("Payment configuration is incomplete.", 503);
  }
  validateStripeKey(secret);
  return { secret, articlePrice, packPrice, packQuantity, origin: url.origin };
}

function validateStripeKey(secret: string) {
  if (!secret.startsWith("sk_test_") && !(secret.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE === "true")) {
    throw new BillingError("Live payments have not been enabled.", 503);
  }
}
export function stripeClient() {
  // Turning off new checkout must not strand already-paid orders or refunds.
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new BillingError("Payments are not configured.", 503);
  validateStripeKey(secret);
  return new Stripe(secret, { maxNetworkRetries: 2, timeout: 20000, httpClient: Stripe.createFetchHttpClient() });
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new BillingError("Invalid request identifier.");
  return value;
}
