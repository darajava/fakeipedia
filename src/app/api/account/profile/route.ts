import { billingUser } from "@/lib/billing/auth";
import { BillingError } from "@/lib/billing/config";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
import { savePublicHandle } from "@/lib/account-profile";

export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const user = await billingUser();
    if (!user) throw new BillingError("Sign in to edit your name or handle.", 401);
    const handle = await savePublicHandle(user.id, (await billingBody(request)).handle);
    return privateJson({ handle });
  });
}
