import type { PaymentAction } from "@/lib/billing-types";
import type { PaymentView } from "@/lib/payment-view";
import styles from "@/app/billing.module.css";

export function PaymentOptions({ price, view, busy, act }: {
  price: string;
  view: PaymentView;
  busy: boolean;
  act: (action: PaymentAction) => Promise<void>;
}) {
  return <section className={styles.billingOptions} aria-label="Article payment">
    <div className={styles.paymentCard}>
      <h2>Generate this article</h2>
      <p className={styles.paymentCardDescription}>One article, including its images.</p>
      <p className={styles.paymentPrice}>{price}<span>One-time payment</span></p>
      <div className={styles.paymentCardActions}>
        <button disabled={busy} onClick={() => act("article")}>
          {busy ? "Opening checkout…" : view.pending ? "Resume checkout" : `Pay ${price} and generate`}
        </button>
      </div>
    </div>
  </section>;
}
