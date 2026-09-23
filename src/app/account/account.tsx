"use client";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { billingFetch, creditCheckoutRequest, creditCheckoutStorageKey, money, type AccountData, type CreditCheckoutRequest } from "@/components/billing-client";
import { PublicHandleForm } from "@/components/public-handle-form";
import { articlePath } from "@/lib/wiki";
export function Account() {
  const [account, setAccount] = useState<AccountData>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<CreditCheckoutRequest | undefined>(undefined);
  const submitting = useRef(false);
  const search = useSearchParams();
  useEffect(() => {
    let active = true;
    const load = async () => { try { const data = await billingFetch<AccountData>("/api/billing/account"); if (active) setAccount(data); } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "Could not load your account."); } };
    void load(); const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function buy() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      // Recheck the active account before choosing a retry key; a user may have
      // switched accounts since the last background refresh.
      const current = await billingFetch<AccountData>("/api/billing/account");
      setAccount(current);
      let storage: Storage | undefined;
      try { storage = sessionStorage; } catch { /* Storage can be unavailable. */ }
      request.current = creditCheckoutRequest(current, request.current, storage);
      const result = await billingFetch<{ url?: string }>("/api/billing/checkout", { kind: "credits", requestId: request.current.requestId });
      if (result.url) window.location.assign(result.url);
      else setAccount(await billingFetch<AccountData>("/api/billing/account"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open checkout."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function cancel(orderId: string) {
    setBusy(true); setError("");
    try {
      await billingFetch("/api/billing/checkout", { action: "cancel", orderId });
      if (request.current?.userId === account?.userId) request.current = undefined;
      try { if (account?.userId) sessionStorage.removeItem(creditCheckoutStorageKey(account.userId)); } catch { /* Optional retry cache. */ }
      setAccount(await billingFetch<AccountData>("/api/billing/account"));
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not cancel checkout."); }
    finally { setBusy(false); }
  }
  const returnedOrder = account?.orders?.find((order) => order.id === search.get("order"));
  const confirmingPayment = search.get("checkout") === "success" && (!account || returnedOrder?.status === "pending");
  return <main className="billing-page">
    <nav className="billing-nav"><Link href="/">Fakeipedia</Link>{account?.signedIn && <UserButton />}</nav>
    <h1>Account & credits</h1>
    {error && <p role="alert" className="billing-error">{error}</p>}
    {!account && <p role="status">Loading your account…</p>}
    {account && !account.signedIn && <>{account.authAvailable ? <><Link prefetch={false} className="billing-button" href="/auth?return=%2Faccount">Create an account</Link><p>Already have an account? <Link prefetch={false} href="/auth?mode=sign-in&return=%2Faccount">Sign in</Link></p></> : <p>Account access is not available yet.</p>}<p>You can still read every article for free and purchase individual articles without an account.</p></>}
    {account?.signedIn && <>
      <section><h2>Public name or handle</h2><PublicHandleForm key={account.userId} initialHandle={account.handle ?? null} /></section>
      <section><h2>{account.credits?.available ?? 0} available credits</h2><p>{account.credits?.reserved ?? 0} reserved for articles in progress. One credit generates one article, including images. Credits do not expire.</p>
      {account.prices && <button disabled={busy || confirmingPayment} onClick={buy}>{confirmingPayment ? "Confirming payment…" : account.orders?.some((order) => !order.intentId && order.status === "pending") ? "Resume credit checkout" : `Buy ${account.prices.pack.credits} credits — ${money(account.prices.pack)}`}</button>}</section>
      {confirmingPayment && <p role="status">Checking your payment… Your credits will appear automatically.</p>}
      {search.get("checkout") === "success" && returnedOrder?.status === "paid" && <p role="status">Payment confirmed. Your credits have been added.</p>}
      {search.get("checkout") === "cancelled" && <p role="status">Checkout was cancelled. No credits are added unless payment completes.</p>}
      <section><h2>Purchases</h2>{!account.orders?.length && <p>No purchases yet.</p>}<ul className="billing-history">{account.orders?.map((order) => <li key={order.id}><span>{order.kind === "credits" ? `${order.credits} credits` : "Article purchase"} · {money(order)} · {order.status.replaceAll("_", " ")}</span><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleDateString()}</time>{order.status === "pending" && <button disabled={busy} onClick={() => cancel(order.id)}>Cancel checkout</button>}{order.refundNeedsAttention && <p>Your refund is awaiting another attempt.</p>}</li>)}</ul></section>
      <section><h2>Funded articles</h2>{!account.jobs?.length && <p>No funded articles yet.</p>}<ul className="billing-history">{account.jobs?.map((job) => <li key={job.id}>{["succeeded", "superseded"].includes(job.status) ? <Link href={articlePath(job.wiki, job.slug)}>{job.title}</Link> : <Link href={`/payment?intent=${job.intentId}`}>{job.title}</Link>}<span>{job.status === "failed" ? "Failed — credit returned or refund requested" : job.status}</span></li>)}</ul></section>
    </>}
  </main>;
}
