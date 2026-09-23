export function PaymentLoading({ openingArticle = false }: { openingArticle?: boolean }) {
  return <div className="payment-loading" role="status" aria-live="polite">
    <span className="payment-loading-spinner" aria-hidden="true" />
    <span>{openingArticle ? "Opening your article…" : "Loading payment options…"}</span>
  </div>;
}
