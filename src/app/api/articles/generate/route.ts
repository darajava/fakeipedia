import { db } from "@/db";
import { billingUser } from "@/lib/billing/auth";
import { BillingError } from "@/lib/billing/config";
import { authorizeIntent, readIntent } from "@/lib/billing/intents";
import { reserveCredit } from "@/lib/billing/credits";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The article model is only called by the durable worker. Neither visiting this
// URL nor replaying the old unauthenticated generation request can invoke it.
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    if (!body.intentId) throw new BillingError("Pay for this article or sign in to use a credit before generating.", 402);
    const user = await billingUser();
    const intent = await readIntent(body.intentId, body.token, user?.id ?? null);
    const existing = await authorizeIntent(intent, user?.id ?? null);
    if (existing) return privateJson({ jobId: existing.id, status: existing.status });
    if (body.funding !== "credit" || !user) throw new BillingError("A verified article payment or an available credit is required.", 402);
    const job = await db.transaction((tx) => reserveCredit(tx, intent, user.id));
    return privateJson({ jobId: job.id, status: job.status }, 202);
  });
}
