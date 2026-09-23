export type Price = { id: string; amount: number; currency: string; credits?: number };
export type AccountData = {
  signedIn: boolean; authAvailable: boolean;
  credits?: { balance: number; reserved: number; available: number };
  prices: { article: Price; pack: Price } | null;
  orders?: { id: string; intentId: string | null; requestId: string; kind: string; status: string; credits: number; amount: number; currency: string; createdAt: string; refundNeedsAttention: boolean }[];
  jobs?: { id: string; intentId: string; wiki: string; slug: string; title: string; status: string; createdAt: string }[];
};
export function money(price: { amount: number; currency: string }) {
  // Stripe represents ISK and UGX in hundredths for backwards compatibility,
  // even though Intl treats them as zero-decimal display currencies.
  const zeroDecimal = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);
  return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency.toUpperCase() }).format(price.amount / (zeroDecimal.has(price.currency.toLowerCase()) ? 1 : 100));
}
export class BillingRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function billingFetch<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new BillingRequestError(result.error ?? "Please try again.", response.status);
  if (body !== undefined && typeof window !== "undefined" && ["/api/articles/generate", "/api/billing/checkout"].includes(url)) window.dispatchEvent(new Event("fakeipedia:credits-changed"));
  return result;
}
export async function startCreditGeneration(intentId: string, token: string) {
  try {
    return await billingFetch<{ jobId: string; status: string }>("/api/articles/generate", { intentId, token, funding: "credit" });
  } catch (error) {
    // Guests, exhausted credits and an existing checkout need the payment step.
    // Other failures must preserve the draft and offer an idempotent retry.
    if (error instanceof BillingRequestError && [402, 409].includes(error.status)) return null;
    throw error;
  }
}
export function purchaseToken(id: string) {
  const fragment = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fragment && /^[a-f0-9]{64}$/.test(fragment)) {
    try { localStorage.setItem(`purchase:${id}`, fragment); } catch { /* The fragment remains a recovery link. */ }
    return fragment;
  }
  try { return localStorage.getItem(`purchase:${id}`) ?? sessionStorage.getItem(`purchase:${id}`) ?? ""; } catch { return ""; }
}
