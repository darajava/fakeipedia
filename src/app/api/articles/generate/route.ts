import { BillingError } from "@/lib/billing/config";
import { authorizeIntent, readIntent } from "@/lib/billing/intents";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only verified Stripe fulfillment can queue a new article.
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    if (!body.intentId) throw new BillingError("Pay for this article before generating.", 402);
    const intent = await readIntent(body.intentId, body.token);
    const job = await authorizeIntent(intent);
    if (!job) throw new BillingError("A verified article payment is required.", 402);
    return privateJson({ jobId: job.id, status: job.status });
  });
}
