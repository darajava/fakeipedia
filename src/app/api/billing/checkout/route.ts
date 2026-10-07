import { readIntent } from "@/lib/billing/intents";
import { cancelCheckout, createCheckout } from "@/lib/billing/payments";
import { BillingError } from "@/lib/billing/config";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
import { isArticleCurrency } from "@/lib/article-pricing";
import { requestCurrency } from "@/lib/request-currency";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    if (body.kind !== undefined && body.kind !== "article" && body.kind !== "cancel") throw new BillingError("Only a single article purchase is available.");
    const intent = await readIntent(body.intentId, body.token);
    if (body.action === "cancel") {
      await cancelCheckout(intent.id);
      return privateJson({ cancelled: true });
    }
    if (body.currency !== undefined && !isArticleCurrency(body.currency)) throw new BillingError("Unsupported payment currency.");
    return privateJson(await createCheckout(intent, body.requestId, requestCurrency(request.headers)));
  });
}
