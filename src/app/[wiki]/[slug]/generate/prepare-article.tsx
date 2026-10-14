"use client";

import { articlePriceLabel, type ArticleCurrency } from "@/lib/article-pricing";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { articlePath } from "@/lib/wiki";
import {
  billingFetch,
  purchaseToken,
} from "@/components/billing-client";
import { GenerateArticle } from "./generate-article";

type Submission = {
  answer: string;
  requestId: string;
  token?: string;
  generating?: boolean;
};

export function PrepareArticle(props: {
  currency: ArticleCurrency;
  wiki: string;
  slug: string;
  title: string;
  sourceSlug: string;
  initialIntentId?: string;
  existingArticleSlugs: string[];
}) {
  const { wiki, slug, title, sourceSlug } = props;
  const router = useRouter();
  const storageKey = `lore:${wiki}:${sourceSlug}:${slug}`;
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<Submission>();
  const [generation, setGeneration] = useState<{ id: string; token: string }>();

  useEffect(() => {
    if (props.initialIntentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGeneration({
        id: props.initialIntentId,
        token: purchaseToken(props.initialIntentId),
      });
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved.answer === "string") {
        // Restore browser-only storage after hydration; it is unavailable during server rendering.
        setAnswer(saved.answer.slice(0, 2000));
        if (
          saved.submission &&
          !new URLSearchParams(location.search).has("newRequest")
        ) {
          setSubmission(saved.submission);
          if (
            !props.initialIntentId &&
            saved.submission.generating &&
            saved.submission.token
          )
            setGeneration({
              id: saved.submission.requestId,
              token: saved.submission.token,
            });
        }
      }
    } catch {
      /* Storage may be unavailable; in-memory retries still work. */
    }
  }, [storageKey, props.initialIntentId]);

  function storeDraft(
    value: string,
    nextSubmission: Submission | null | undefined = submission,
  ) {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ answer: value, submission: nextSubmission }),
      );
    } catch {
      /* Optional recovery across reloads. */
    }
  }

  async function begin() {
    if (submitting) return;
    const selectedAnswer = answer.trim() ? answer : "";
    const fields = { answer: selectedAnswer };
    const same = submission && submission.answer === fields.answer;
    const token =
      same && submission.token
        ? submission.token
        : Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
    const next = {
      ...fields,
      requestId: same ? submission.requestId : crypto.randomUUID(),
      token,
    };
    setSubmission(next);
    storeDraft(answer, next);
    setSubmitting(true);
    setError(undefined);
    try {
      // Keep the capability through checkout. The answer itself is
      // stored on the server before leaving this page.
      try {
        localStorage.setItem(`purchase:${next.requestId}`, token);
        sessionStorage.setItem(`purchase:${next.requestId}`, token);
      } catch {
        /* Private link also carries the capability. */
      }
      const result = await billingFetch<{ id: string; exists: boolean; generating: boolean }>(
        "/api/billing/intents",
        { wiki, slug, sourceSlug, title, ...next },
      );
      if (result.exists) {
        router.replace(articlePath(wiki, slug));
        return;
      }
      if (result.generating) {
        const started = { ...next, generating: true };
        setSubmission(started);
        storeDraft(answer, started);
        setGeneration({ id: result.id, token });
        return;
      }
      router.push(`/payment?intent=${result.id}#token=${token}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save your answer. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {generation ? (
        <GenerateArticle
          wiki={wiki}
          slug={slug}
          title={title}
          intentId={generation.id}
          token={generation.token}
          existingArticleSlugs={props.existingArticleSlugs}
          onRetry={() => {
            if (submission?.answer === "freebie") {
              setSubmission(undefined);
              storeDraft(answer, null);
              setGeneration(undefined);
              if (props.initialIntentId) {
                const query = new URLSearchParams({ title, source: sourceSlug, newRequest: "1" });
                router.replace(`${articlePath(wiki, slug)}/generate?${query}`);
              }
              return;
            }
            router.push(
              `/payment?intent=${generation.id}#token=${generation.token}`,
            );
          }}
        />
      ) : props.initialIntentId ? (
        <p role="status">Loading generation…</p>
      ) : (
        <section className="wiki-lore-preparation">
          <h1>{title}</h1>
          <p>Make your mark on Fakeipedia</p>
          <p>Your article will be generated using Gemini 4 Argon.</p>
          {error && <p role="alert">{error}</p>}
          <label htmlFor="lore-answer" className="wiki-lore-question">
            Optionally: in a few words say how {title} fits into this world.
            This will help guide the article’s content.
          </label>
          <textarea
            id="lore-answer"
            value={answer}
            maxLength={2000}
            rows={5}
            aria-describedby="lore-disclosure lore-count"
            onChange={(event) => {
              setAnswer(event.target.value);
              storeDraft(event.target.value);
            }}
          />
          <p id="lore-disclosure" className="wiki-subtitle">
            Your answer and name will appear publicly in this article&apos;s
            Discussion.
          </p>
          <p id="lore-count" className="wiki-subtitle">
            {answer.length.toLocaleString()} / 2,000 characters
          </p>
          <div className="wiki-lore-actions">
            <button type="button" onClick={begin} disabled={submitting}>
              {submitting ? "Preparing your article…" : `Continue — ${articlePriceLabel(props.currency)}`}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
