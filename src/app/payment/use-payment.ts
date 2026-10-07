"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { billingFetch, purchaseToken } from "@/components/billing-client";
import { useBillingAction } from "@/components/use-billing-action";
import { useBillingResource } from "@/components/use-billing-resource";
import type { PaymentAction, PaymentStatus } from "@/lib/billing-types";
import { generationPath, paymentView } from "@/lib/payment-view";

export function usePayment(intentId: string, checkout: string | null) {
  const router = useRouter();
  const action = useBillingAction();
  const load = useCallback(async () => {
    const token = purchaseToken(intentId);
    const status = await billingFetch<PaymentStatus>("/api/billing/status", { intentId, token });
    return { status, token };
  }, [intentId]);
  const resource = useBillingResource(load, 3000, "Could not check payment.");
  const data = resource.state.status === "ready" ? resource.state.data : undefined;
  const view = data ? paymentView(data.status, checkout) : undefined;

  useEffect(() => {
    if (!data) return;
    const { intent } = data.status;
    // Keep the saved answer available when returning from checkout.
    try {
      const key = `lore:${intent.wiki}:${intent.sourceSlug}:${intent.slug}`;
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ answer: intent.answer }));
    } catch { /* The server still retains the answer. */ }
  }, [data]);

  const destination = data && view?.stage === "opening"
    ? data.status.job?.previewComplete ? view.target : generationPath(data.status.intent, data.token)
    : undefined;
  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  async function act(kind: PaymentAction) {
    if (!data) return;
    const { token } = data;
    await action.run(async (isActive) => {
      const body = { intentId, token, requestId: crypto.randomUUID() };
      const result = await billingFetch<{ url?: string }>("/api/billing/checkout", {
        ...body,
        kind,
        action: kind === "cancel" ? "cancel" : undefined,
      });
      if (!isActive()) return;
      if (result.url) window.location.assign(result.url);
      else await resource.refresh();
    }, "Please try again.");
  }

  return {
    state: resource.state,
    view,
    opening: Boolean(destination),
    busy: action.busy,
    error: action.error,
    act,
    retry: resource.retry,
  };
}
