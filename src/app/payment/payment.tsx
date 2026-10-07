"use client";

import { articlePriceLabel } from "@/lib/article-pricing";
import styles from "@/app/billing.module.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PaymentLoading } from "./payment-loading";
import { PaymentNotices } from "./payment-notices";
import { PaymentOptions } from "./payment-options";
import { usePayment } from "./use-payment";

export function Payment() {
  const search = useSearchParams();
  const id = search.get("intent") ?? "";
  return <PaymentContent key={id} id={id} checkout={search.get("checkout")} />;
}

function PaymentContent({ id, checkout }: { id: string; checkout: string | null }) {
  const { state, view, opening, busy, error, act, retry } = usePayment(id, checkout);
  if (opening) return <PaymentLoading openingArticle />;
  if (state.status === "loading") return <PaymentLoading />;
  if (state.status === "error") {
    return <div className={styles.paymentLoadError}>
      <p role="alert" className={styles.billingError}>{state.error}</p>
      <button type="button" onClick={retry}>Retry</button>

    </div>;
  }
  const { status } = state.data;
  const price = articlePriceLabel(status.currency, status.amount);
  if (!view) return null;

  return <>
    <header className={styles.paymentHeading}>
      <h1>{status.intent.title}</h1>
      <p className={styles.paymentIntro}>Reading is free. A one-time {price} payment generates {status.intent.title}, including its images.</p>
      <p className={styles.paymentExplanation}>Generating articles and images costs us money. Your purchase helps cover those costs and keeps reading free for everyone.</p>
    </header>
    <aside className={styles.paymentWorldNote}>
      <strong>Help build this world.</strong>
      <p>Your contribution becomes part of a shared world. Everyone will be able to read and explore the article you help create.</p>
    </aside>
    {(error || state.error) && <p role="alert" className={styles.billingError}>{error || state.error}</p>}
    <PaymentNotices status={status} view={view} />
    {view.stage === "options" && <PaymentOptions price={price} view={view} busy={busy} act={act} />}
    {view.canCancel && <button disabled={busy} onClick={() => act("cancel")}>Cancel pending checkout</button>}
    {view.stage === "terminal" && <p><Link href={view.retryPath}>Return to your answer and try a new request</Link></p>}
  </>;
}
