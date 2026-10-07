export function money(price: { amount: number; currency: string }) {
  // Stripe represents ISK and UGX in hundredths for backwards compatibility,
  // even though Intl treats them as zero-decimal display currencies.
  const zeroDecimal = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);
  const divisor = zeroDecimal.has(price.currency.toLowerCase()) ? 1 : 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(price.amount / divisor);
}

export class BillingRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function billingFetch<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new BillingRequestError(result.error ?? "Please try again.", response.status);
  return result.result;
}

export function purchaseToken(id: string) {
  const fragment = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fragment && /^[a-f0-9]{64}$/.test(fragment)) {
    try { localStorage.setItem(`purchase:${id}`, fragment); } catch { /* The fragment remains a recovery link. */ }
    return fragment;
  }
  try {
    return localStorage.getItem(`purchase:${id}`) ?? sessionStorage.getItem(`purchase:${id}`) ?? "";
  } catch { return ""; }
}
