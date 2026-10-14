import { authorizeIntent, saveIntent } from "@/lib/billing/intents";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
import { existingArticle } from "@/lib/billing/worker";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const intent = await saveIntent(await billingBody(request));
    return privateJson({ id: intent.id, exists: Boolean(await existingArticle(intent)), generating: Boolean(await authorizeIntent(intent)) });
  });
}
