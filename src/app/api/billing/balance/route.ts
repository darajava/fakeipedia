import { billingUser } from "@/lib/billing/auth";
import { creditBalance } from "@/lib/billing/credits";
import { billingEndpoint, privateJson } from "@/lib/billing/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return billingEndpoint(request, async () => {
    const user = await billingUser();
    return privateJson(user ? { signedIn: true, available: (await creditBalance(user.id)).available } : { signedIn: false });
  });
}
