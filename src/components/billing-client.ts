export type Price = { id: string; amount: number; currency: string; credits?: number };
export type AccountData = {
  signedIn: boolean; authAvailable: boolean;
  userId?: number;
  credits?: { balance: number; reserved: number; available: number };
  prices: { article: Price; pack: Price } | null;
  orders?: { id: string; intentId: string | null; requestId: string; kind: string; status: string; credits: number; amount: number; currency: string; createdAt: string; refundNeedsAttention: boolean }[];
  jobs?: { id: string; intentId: string; wiki: string; slug: string; title: string; status: string; createdAt: string }[];
};
export type CreditCheckoutRequest = { userId: number; requestId: string };
export function creditCheckoutStorageKey(userId: number) {
  return `credit-checkout-request:${userId}`;
}
export function creditCheckoutRequest(
  account: AccountData,
  previous?: CreditCheckoutRequest,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): CreditCheckoutRequest {
  if (!account.signedIn || !account.userId) throw new Error("Sign in to buy credits.");
  const key = creditCheckoutStorageKey(account.userId);
  let stored = "";
  try {
    // The old shared key has no owner. Only server-confirmed pending orders
    // may recover those checkouts; never give its value to another account.
    storage?.removeItem("credit-checkout-request");
    stored = storage?.getItem(key) ?? "";
  } catch { /* In-memory retries remain available when storage is blocked. */ }
  const pending = account.orders?.find((order) => !order.intentId && order.kind === "credits" && order.status === "pending");
  const candidate = previous?.userId === account.userId ? previous.requestId : stored;
  const processed = account.orders?.some((order) => order.requestId === candidate && order.status !== "pending");
  const requestId = pending?.requestId || (!processed && candidate) || crypto.randomUUID();
  try { storage?.setItem(key, requestId); } catch { /* Keep the request in memory. */ }
  return { userId: account.userId, requestId };
}
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
