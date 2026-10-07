import Stripe from "stripe";
import { ARTICLE_PRICE_AMOUNT, articlePriceLabel, type ArticleCurrency } from "../article-pricing";

export class BillingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function billingConfig() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const articlePrice = process.env.STRIPE_ARTICLE_PRICE_ID;
  const origin = process.env.APP_URL;
  if (process.env.BILLING_ENABLED !== "true" || !secret || !articlePrice || !origin) {
    throw new BillingError("Payments are not available yet. Your answer has been saved.", 503);
  }
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new BillingError("Payment configuration is incomplete.", 503);
  }
  validateStripeKey(secret);
  return { secret, articlePrice, origin: url.origin };
}

function validateStripeKey(secret: string) {
  if (!/^(?:sk|rk)_(?:test|live)_.+$/.test(secret)) {
    throw new BillingError("A Stripe secret or restricted API key is required.", 503);
  }
  if (/^(?:sk|rk)_live_/.test(secret) && process.env.STRIPE_ALLOW_LIVE !== "true") {
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

export function validateArticlePrice(price: Stripe.Price, currency: ArticleCurrency) {
  const amount = price.currency === currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
  if (!price.active || price.type !== "one_time" || price.billing_scheme !== "per_unit" ||
      amount !== ARTICLE_PRICE_AMOUNT || price.transform_quantity) {
    throw new BillingError(`The article price must be a one-time payment of ${articlePriceLabel(currency)}.`, 503);
  }
}
