export const ARTICLE_PRICE_AMOUNTS = { usd: 90, gbp: 85, eur: 90 } as const;

export type ArticleCurrency = "usd" | "gbp" | "eur";

// Euro-area members (including Bulgaria from 2026), plus other euro users.
const euroCountries = new Set([
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
  "AD", "MC", "SM", "VA", "ME", "XK", "AX", "BL", "GF", "GP", "MF", "MQ", "PM", "RE", "YT",
]);

export function isArticleCurrency(value: unknown): value is ArticleCurrency {
  return value === "usd" || value === "gbp" || value === "eur";
}

export function currencyForCountry(country: string): ArticleCurrency {
  const region = country.toUpperCase();
  if (region === "GB") return "gbp";
  return euroCountries.has(region) ? "eur" : "usd";
}

export function articlePriceLabel(currency: ArticleCurrency, amount: number = ARTICLE_PRICE_AMOUNTS[currency]) {
  return `${{ usd: "$", gbp: "£", eur: "€" }[currency]}${(amount / 100).toFixed(2)}`;
}

export function isArticleOrder(order: { kind: string; amount: number; currency: string }) {
  // Honor the original price of checkouts opened before price changes.
  return order.kind === "article" && isArticleCurrency(order.currency) &&
    (order.amount === ARTICLE_PRICE_AMOUNTS[order.currency] || order.amount === 100 || order.amount === 150);
}
