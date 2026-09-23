import { billingUser } from "@/lib/billing/auth";
import { authorizeIntent, readIntent } from "@/lib/billing/intents";
import { cancelCheckout, createCheckout } from "@/lib/billing/payments";
import { BillingError } from "@/lib/billing/config";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    const user = await billingUser();
    const intent = body.intentId ? await readIntent(body.intentId, body.token, user?.id ?? null) : null;
    if (intent) await authorizeIntent(intent, user?.id ?? null);
    if (!intent && !user) throw new BillingError("Sign in to manage credit purchases.", 401);
    if (body.action === "cancel") {
      await cancelCheckout(intent?.id ?? null, user?.id ?? null, body.orderId);
      return privateJson({ cancelled: true });
    }
    if (body.kind !== "article" && body.kind !== "credits") throw new BillingError("Choose an article purchase or a credit pack.");
    return privateJson(await createCheckout(body.kind, intent, user?.id ?? null, body.requestId));
  });
}
