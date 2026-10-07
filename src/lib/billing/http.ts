import { BillingError } from "./config";
import { LoreInputError } from "../lore-input";

export function privateJson(data: unknown, status = 200) {
  return Response.json(status >= 400 ? data : { result: data }, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export async function billingBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 16000) throw new BillingError("This request is too large.", 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new BillingError("A valid JSON request is required."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BillingError("A valid request is required.");
  return body as Record<string, unknown>;
}
export async function billingEndpoint(request: Request, handler: () => Promise<Response>) {
  try {
    // A browser may only change payment state from this site's own pages. Stripe
    // webhooks use a separate signature-verified handler.
    const origin = request.headers.get("origin");
    // Next.js can build request.url with its listening hostname (e.g. localhost)
    // rather than the host the browser visited. It preserves the public protocol.
    const url = new URL(request.url);
    const host = request.headers.get("host");
    const requestOrigin = host ? `${url.protocol}//${host}` : url.origin;
    if (request.method === "POST" && origin && origin !== requestOrigin && origin !== (process.env.APP_URL ? new URL(process.env.APP_URL).origin : undefined)) {
      throw new BillingError("This request must come from Fakeipedia.", 403);
    }
    return await handler();
  } catch (error) {
    if (error instanceof BillingError) return privateJson({ error: error.message }, error.status);
    if (error instanceof LoreInputError) return privateJson({ error: error.message }, 400);
    console.error("Billing request failed:", error instanceof Error ? error.message : "Unknown error");
    return privateJson({ error: "Something went wrong. Your saved answer is safe. Please try again." }, 500);
  }
}
