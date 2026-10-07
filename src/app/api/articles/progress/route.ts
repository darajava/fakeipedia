import { BillingError } from "@/lib/billing/config";
import { billingBody, billingEndpoint } from "@/lib/billing/http";
import { authorizeIntent, readIntent } from "@/lib/billing/intents";
import { generationStream } from "@/lib/billing/generation-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    const intent = await readIntent(body.intentId, body.token);
    const job = await authorizeIntent(intent);
    if (!job) throw new BillingError("Generation has not started. Return to your answer to try again.", 409);
    return new Response(await generationStream(job.id, request.signal), { headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Content-Encoding": "identity",
      "X-Accel-Buffering": "no",
      "Referrer-Policy": "no-referrer",
    } });
  });
}
