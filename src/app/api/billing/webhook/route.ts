import { stripeClient } from "@/lib/billing/config";
import { fulfillCheckout } from "@/lib/billing/payments";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return Response.json({ error: "Webhook signature required." }, { status: 400 });
  const stripe = stripeClient();
  let event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, secret); }
  catch { return Response.json({ error: "Invalid webhook signature." }, { status: 400 }); }
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await fulfillCheckout(event.data.object.id);
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe fulfillment needs retry:", event.id, error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Fulfillment will retry." }, { status: 500 });
  }
}
