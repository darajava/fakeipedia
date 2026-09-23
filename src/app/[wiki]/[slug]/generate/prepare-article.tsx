"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { articlePath } from "@/lib/wiki";
import { billingFetch, purchaseToken, startCreditGeneration } from "@/components/billing-client";
import { GenerateArticle } from "./generate-article";

type Question = { questionSetId: number; question: string; title: string; sourceTitle: string; fallback: boolean };
type Submission = { answer: string; questionSetId?: number; fallbackQuestion?: boolean; requestId: string; token?: string; generating?: boolean };

export function PrepareArticle(props: { wiki: string; slug: string; title: string; sourceSlug: string; initialIntentId?: string; existingArticleSlugs: string[]; children?: ReactNode }) {
  const { wiki, slug, title, sourceSlug } = props;
  const router = useRouter();
  const storageKey = `lore:${wiki}:${sourceSlug}:${slug}`;
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState<Question>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<Submission>();
  const [generation, setGeneration] = useState<{ id: string; token: string }>();

  useEffect(() => {
    if (props.initialIntentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGeneration({ id: props.initialIntentId, token: purchaseToken(props.initialIntentId) });
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved.answer === "string") {
        // Restore browser-only storage after hydration; it is unavailable during server rendering.
        setAnswer(saved.answer.slice(0, 2000));
        if (saved.submission && !new URLSearchParams(location.search).has("newRequest")) {
          setSubmission(saved.submission);
          if (!props.initialIntentId && saved.submission.generating && saved.submission.token) setGeneration({ id: saved.submission.requestId, token: saved.submission.token });
        }
      }
    } catch { /* Storage may be unavailable; in-memory retries still work. */ }
  }, [storageKey, props.initialIntentId]);

  useEffect(() => {
    if (generation || props.initialIntentId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryRequested = retry > 0;
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch("/api/articles/questions", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ wiki, slug, sourceSlug, retry: retryRequested }),
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result.exists) { router.replace(articlePath(wiki, slug)); return; }
        if (response.status === 202) {
          // Poll the in-flight attempt without starting another retry if it fails.
          retryRequested = false;
          timer = setTimeout(load, 2000);
          return;
        }
        if (!response.ok) throw new Error(result.error || "Could not load a question.");
        setQuestion(result);
        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(error instanceof Error ? error.message : "Could not load a question.");
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [wiki, slug, sourceSlug, retry, router, generation, props.initialIntentId]);

  function storeDraft(value: string, nextSubmission: Submission | null | undefined = submission) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ answer: value, submission: nextSubmission })); } catch { /* Optional recovery across reloads. */ }
  }

  async function begin() {
    if (submitting) return;
    const selectedAnswer = answer.trim() ? answer : "";
    if (selectedAnswer && !question) return;
    const fields = { answer: selectedAnswer, questionSetId: question?.questionSetId, fallbackQuestion: question?.fallback };
    const same = submission && submission.answer === fields.answer && submission.questionSetId === fields.questionSetId && submission.fallbackQuestion === fields.fallbackQuestion;
    const token = same && submission.token ? submission.token : Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const next = { ...fields, requestId: same ? submission.requestId : crypto.randomUUID(), token };
    setSubmission(next);
    storeDraft(answer, next);
    setSubmitting(true);
    setError(undefined);
    try {
      // Keep the capability through hosted sign-in/checkout. The answer itself is
      // stored on the server before leaving this page.
      try { localStorage.setItem(`purchase:${next.requestId}`, token); sessionStorage.setItem(`purchase:${next.requestId}`, token); } catch { /* Private link also carries the capability. */ }
      const result = await billingFetch<{ id: string; exists: boolean }>("/api/billing/intents", { wiki, slug, sourceSlug, title: question?.title ?? title, ...next });
      if (result.exists) { router.replace(articlePath(wiki, slug)); return; }
      const job = await startCreditGeneration(result.id, token);
      if (job) {
        const started = { ...next, generating: true };
        setSubmission(started);
        storeDraft(answer, started);
        setGeneration({ id: result.id, token });
        router.replace(`${articlePath(wiki, slug)}/generate?title=${encodeURIComponent(question?.title ?? title)}&source=${encodeURIComponent(sourceSlug)}&intent=${result.id}#token=${token}`);
        return;
      }
      router.push(`/payment?intent=${result.id}#token=${token}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save your answer. Please try again."); }
    finally { setSubmitting(false); }
  }

  return <>{generation ? <GenerateArticle wiki={wiki} slug={slug} title={question?.title ?? title} intentId={generation.id} token={generation.token} existingArticleSlugs={props.existingArticleSlugs}
    onRetry={() => { router.push(`/payment?intent=${generation.id}#token=${generation.token}`); }} /> : props.initialIntentId ? <p role="status">Loading generation…</p> : <section className="wiki-lore-preparation">
    <h1>{question?.title ?? title}</h1>
    <p>Shape this world, give your input into how the {question?.title ?? title} article will be generated.</p>
    {loading && <p role="status">Finding a question from the source article…</p>}
    {error && <p role="alert">{error}</p>}
    {question && <>
      {question.fallback && <p className="wiki-subtitle">A tailored question is unavailable. You can answer this general question or try again.</p>}
      <label htmlFor="lore-answer" className="wiki-lore-question">{question.question}</label>
      <textarea id="lore-answer" value={answer} maxLength={2000} rows={5} aria-describedby="lore-disclosure lore-count"
        onChange={(event) => { setAnswer(event.target.value); storeDraft(event.target.value); }} />
      <p id="lore-disclosure" className="wiki-subtitle">Optional. Your answer and name will appear publicly in this article’s Discussion and will be adapted to fit existing lore.</p>
      <p id="lore-count" className="wiki-subtitle">{answer.length.toLocaleString()} / 2,000 characters</p>
    </>}
    <div className="wiki-lore-actions">
      <button type="button" onClick={begin} disabled={submitting || (Boolean(answer.trim()) && (!question || loading))}>{submitting ? "Preparing your article…" : "Generate article"}</button>
      {(error || question?.fallback) && <button type="button" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Retry question</button>}
    </div>
  </section>}
    {!generation && !props.initialIntentId && props.children}
  </>;
}
