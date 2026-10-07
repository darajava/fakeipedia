import styles from "@/app/billing.module.css";
export function PaymentLoading({ openingArticle = false }: { openingArticle?: boolean }) {
  return <div className={styles.paymentLoading} role="status" aria-live="polite">
    <span className={styles.paymentLoadingSpinner} aria-hidden="true" />
    <span>{openingArticle ? "Opening your article…" : "Loading payment…"}</span>
  </div>;
}
