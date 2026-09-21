"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { articlePath } from "@/lib/wiki";
import { GenerateArticle, type GenerateArticleProps } from "./generate-article";

type Question = { questionSetId: number; question: string; title: string; sourceTitle: string; fallback: boolean };
type Submission = { answer: string; questionSetId?: number; fallbackQuestion?: boolean; requestId: string };

export function PrepareArticle(props: GenerateArticleProps & { children?: ReactNode }) {
  const { wiki, slug, title, sourceSlug } = props;
  const router = useRouter();
  const storageKey = `lore:${wiki}:${sourceSlug}:${slug}`;
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState<Question>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(false);
  const [submission, setSubmission] = useState<Submission>();

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved.answer === "string") {
        // Restore browser-only storage after hydration; it is unavailable during server rendering.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnswer(saved.answer.slice(0, 2000));
        if (saved.submission) setSubmission(saved.submission);
      }
    } catch { /* Storage may be unavailable; in-memory retries still work. */ }
  }, [storageKey]);

  useEffect(() => {
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
  }, [wiki, slug, sourceSlug, retry, router]);

  function storeDraft(value: string, nextSubmission = submission) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ answer: value, submission: nextSubmission })); } catch { /* Optional recovery across reloads. */ }
  }

  function begin() {
    const selectedAnswer = answer.trim() ? answer : "";
    if (selectedAnswer && !question) return;
    const fields = { answer: selectedAnswer, questionSetId: question?.questionSetId, fallbackQuestion: question?.fallback };
    const same = submission && submission.answer === fields.answer && submission.questionSetId === fields.questionSetId && submission.fallbackQuestion === fields.fallbackQuestion;
    const next = { ...fields, requestId: same ? submission.requestId : crypto.randomUUID() };
    setSubmission(next);
    storeDraft(answer, next);
    setActive(true);
  }

  if (active && submission) return <GenerateArticle {...props} {...submission} title={question?.title ?? title} onRetry={() => setActive(false)} />;

  return <><section className="wiki-lore-preparation">
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
      <button type="button" onClick={begin} disabled={Boolean(answer.trim()) && (!question || loading)}>Generate article</button>
      {(error || question?.fallback) && <button type="button" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Retry question</button>}
    </div>
  </section>
    {props.children}
  </>;
}
