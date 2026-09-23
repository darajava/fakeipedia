"use client";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { billingFetch, money, purchaseToken, type AccountData } from "@/components/billing-client";
import { articlePath } from "@/lib/wiki";
import { PaymentLoading } from "./payment-loading";

type Status = {
  intent: { id: string; wiki: string; slug: string; title: string; sourceSlug: string; answer: string };
  job: { id: string; orderId: string | null; status: string; attempts: number; funding: string; previewComplete: boolean } | null;
  orders: { id: string; kind: string; status: string; refundNeedsAttention: boolean }[];
  exists: boolean; signedIn: boolean; credits: { available: number; reserved: number } | null;
};
export function Payment() {
  const search = useSearchParams();
  const id = search.get("intent") ?? "";
  return <PaymentContent key={id} id={id} />;
}

function PaymentContent({ id }: { id: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>();
  const [account, setAccount] = useState<AccountData>();
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [retry, setRetry] = useState(0);
  const [redirecting, setRedirecting] = useState(false);
  const refresh = useCallback(async (includeAccount = false, isActive: () => boolean = () => true) => {
    const capability = purchaseToken(id);
    // Reveal the first view only when both the saved request and prices are ready.
    const [result, catalog] = await Promise.all([
      billingFetch<Status>("/api/billing/status", { intentId: id, token: capability }),
      includeAccount ? billingFetch<AccountData>("/api/billing/account").then((data) => {
        if (isActive()) setAccount(data);
        return data;
      }) : Promise.resolve(undefined),
    ]);
    if (!isActive()) return;
    setToken(capability);
    // Email links can return in a new tab. Rehydrate that tab's question draft
    // from the saved server snapshot for navigation and generation retries.
    try {
      const key = `lore:${result.intent.wiki}:${result.intent.sourceSlug}:${result.intent.slug}`;
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ answer: result.intent.answer }));
    } catch { /* The saved server snapshot remains available on this page. */ }
    if (result.job?.previewComplete) {
      setRedirecting(true);
      router.replace(articlePath(result.intent.wiki, result.intent.slug));
    }
    else if (result.job && ["queued", "running", "succeeded"].includes(result.job.status)) {
      setRedirecting(true);
      router.replace(`${articlePath(result.intent.wiki, result.intent.slug)}/generate?title=${encodeURIComponent(result.intent.title)}&source=${encodeURIComponent(result.intent.sourceSlug)}&intent=${id}${capability ? `#token=${capability}` : ""}`);
    }
    else {
      setStatus(result);
      if (catalog) setAccount(catalog);
    }
    return result;
  }, [id, router]);
  useEffect(() => {
    let cancelled = false;
    let initial = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try { await refresh(initial, () => !cancelled); if (!cancelled) { initial = false; setLoadError(""); timer = setTimeout(load, 3000); } }
      catch (failure) { if (!cancelled) { setLoadError(failure instanceof Error ? failure.message : "Could not check payment."); timer = setTimeout(load, 10000); } }
    }
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh, retry]);

  async function act(action: "article" | "credits" | "credit" | "cancel") {
    setBusy(true); setError("");
    try {
      const body = { intentId: id, token, requestId: crypto.randomUUID() };
      if (action === "credit") {
        await billingFetch("/api/articles/generate", { ...body, funding: "credit" });
        if (status) {
          setRedirecting(true);
          router.push(`${articlePath(status.intent.wiki, status.intent.slug)}/generate?title=${encodeURIComponent(status.intent.title)}&source=${encodeURIComponent(status.intent.sourceSlug)}&intent=${id}${token ? `#token=${token}` : ""}`);
          return;
        }
      }
      else {
        const result = await billingFetch<{ url?: string }>("/api/billing/checkout", { ...body, kind: action, action: action === "cancel" ? "cancel" : undefined });
        if (result.url) { window.location.assign(result.url); return; }
      }
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const job = status?.job;
  const generating = job && ["queued", "running"].includes(job.status);
  const terminal = job && ["failed", "superseded"].includes(job.status);
  const pending = status?.orders.some((order) => order.status === "pending");
  const pendingArticle = status?.orders.some((order) => order.status === "pending" && order.kind === "article");
  const pendingPack = status?.orders.some((order) => order.status === "pending" && order.kind === "credits");
  const confirmingPayment = search.get("checkout") === "success" && pending && !job;
  const refunded = status?.orders.some((order) => order.id === job?.orderId && order.status === "refunded");
  const refundPending = status?.orders.some((order) => order.status === "refund_pending");
  const target = status && articlePath(status.intent.wiki, status.intent.slug);
  const back = status && `${target}/generate?title=${encodeURIComponent(status.intent.title)}&source=${encodeURIComponent(status.intent.sourceSlug)}${terminal ? "&newRequest=1" : ""}`;
  if (redirecting) return <PaymentLoading openingArticle />;
  if (!status || !account) {
    if (!loadError) return <PaymentLoading />;
    return <div className="payment-load-error">
      <p role="alert" className="billing-error">{loadError}</p>
      <button type="button" onClick={() => { setLoadError(""); setRetry((n) => n + 1); }}>Retry</button>
      {account?.authAvailable && !account.signedIn && <p><Link prefetch={false} href={`/auth?mode=sign-in&return=${encodeURIComponent(`/payment?intent=${id}`)}`}>Sign in to resume your purchase</Link></p>}
    </div>;
  }
  return <>
    <header className="payment-heading">
      <h1>{status.intent.title}</h1>
      <p className="payment-intro">Reading is free. One purchase or one credit generates {status.intent.title}, including its images.</p>
      <p className="payment-explanation">Generating articles and images costs us money. Your purchase helps cover those costs and keeps reading free for everyone.</p>
    </header>
    <aside className="payment-world-note">
      <strong>Help build this world.</strong>
      <p>Your contribution becomes part of a shared world. Everyone will be able to read and explore the article you help create.</p>
    </aside>
    {(error || loadError) && <p role="alert" className="billing-error">{error || loadError}</p>}
    {search.get("checkout") === "cancelled" && !generating && !terminal && <p role="status">Checkout was cancelled. Your answer is still saved. Resume checkout or cancel the pending checkout below to choose another option.</p>}
    {search.get("checkout") === "success" && (!status || confirmingPayment) && <p role="status">Checking your payment… Generation starts after payment is confirmed.</p>}
    {terminal && <section aria-live="polite"><h2>{job.status === "superseded" ? "This article was generated by another reader" : "We couldn’t finish this article"}</h2><p>{job.funding === "credit" ? "Your credit has been returned." : refunded ? "Your payment has been refunded." : "Your payment is being refunded automatically."}</p></section>}
    {refundPending && <p role="status">Your refund is being processed.{status?.orders.some((order) => order.refundNeedsAttention) ? " It needs another attempt; your payment remains recorded." : ""}</p>}
    {status?.exists && target && !generating && <p><Link href={target}>Read the article</Link>{!job && " — no further payment is needed."}</p>}
    {status && !job && !status.exists && !confirmingPayment && <section className="billing-options" aria-label="Payment options">
      <div className="payment-card">
        <h2>Pay for this article</h2>
        <p className="payment-card-description">One article, including its images.{!status.signedIn && " No account required."}</p>
        {account.prices ? <p className="payment-price">{money(account.prices.article)}<span>One-time payment</span></p> : <p>Payments are not available yet.</p>}
        <div className="payment-card-actions"><button disabled={busy || !account.prices || pendingPack} onClick={() => act("article")}>{pendingArticle ? "Resume article checkout" : "Pay for this article"}</button></div>
      </div>
      <div className="payment-card"><h2>{status.signedIn ? "Use credits" : "Generate with credits"}</h2>
        <p className="payment-card-description">One credit, one article. Credits do not expire.</p>
        {status.signedIn ? <>
          <p className="payment-price">{status.credits?.available ?? 0}<span>Available {(status.credits?.available ?? 0) === 1 ? "credit" : "credits"}{status.credits?.reserved ? ` · ${status.credits.reserved} reserved` : ""}</span></p>
          {account.prices && <p>{account.prices.pack.credits} credits for {money(account.prices.pack)}.</p>}
          <div className="payment-card-actions">
            {(status.credits?.available ?? 0) > 0 && <button disabled={busy || pending} onClick={() => act("credit")}>Generate for 1 credit</button>}
            {account.prices && <button disabled={busy || pendingArticle} onClick={() => act("credits")}>{pendingPack ? "Resume credit checkout" : `Buy ${account.prices.pack.credits} credits and generate`}</button>}
          </div>
        </> : <>
          {account.prices && <p className="payment-price">{money(account.prices.pack)}<span>Pack of {account.prices.pack.credits} credits</span></p>}
          <div className="payment-card-actions">{account.authAvailable ? <>
            <Link prefetch={false} className="billing-button" href={`/auth?return=${encodeURIComponent(`/payment?intent=${id}`)}`}>Create an account to buy credits</Link>
            <p className="payment-sign-in">Already have an account? <Link prefetch={false} href={`/auth?mode=sign-in&return=${encodeURIComponent(`/payment?intent=${id}`)}`}>Sign in</Link></p>
          </> : <p>Account access is not available yet.</p>}</div>
        </>}
      </div>
    </section>}
    {pending && !job && !confirmingPayment && <button disabled={busy} onClick={() => act("cancel")}>Cancel pending checkout</button>}
    {back && terminal && <p><Link href={back}>Return to your answer and try a new request</Link></p>}
  </>;
}
