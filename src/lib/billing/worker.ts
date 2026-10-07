import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { articles, generationIntents, generationJobs, loreContributions } from "../../db/schema";
import { generateArticleRequest } from "../article-generation";
import { completeJob, releaseFunding, type Job } from "./jobs";
import { applyGenerationEvent, emptyGenerationProgress, type GenerationEvent, type GenerationProgress } from "../generation-progress";
import { notifyGeneration } from "./generation-stream";

export async function publishGenerationProgress(job: Job, progress: GenerationProgress) {
  await db.update(generationJobs).set({ progress, progressUpdatedAt: new Date() })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.leaseToken, job.leaseToken!), or(eq(generationJobs.status, "running"), eq(generationJobs.status, "succeeded"))));
}

export async function claimJob() {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(generationJobs).where(and(
      lt(generationJobs.attempts, 3),
      or(and(eq(generationJobs.status, "queued"), sql`${generationJobs.availableAt} <= now()`), and(eq(generationJobs.status, "running"), sql`${generationJobs.leasedUntil} < now()`)),
    )).orderBy(generationJobs.availableAt).limit(1).for("update", { skipLocked: true });
    if (!job) return null;
    const [claimed] = await tx.update(generationJobs).set({ status: "running", attempts: job.attempts + 1, leaseToken: crypto.randomUUID(), leasedUntil: sql`now() + interval '2 minutes'`, error: null, progress: emptyGenerationProgress(), progressUpdatedAt: new Date() }).where(eq(generationJobs.id, job.id)).returning();
    return claimed;
  });
}

export async function finishFailure(job: Job, message: string, superseded = false, busy = false, expiredOnly = false) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(generationJobs).where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, "running"), eq(generationJobs.leaseToken, job.leaseToken!), expiredOnly ? sql`${generationJobs.leasedUntil} < now()` : undefined)).for("update");
    if (!current) return;
    const terminal = superseded || (!busy && current.attempts >= 3);
    await tx.update(generationJobs).set({
      status: superseded ? "superseded" : terminal ? "failed" : "queued",
      attempts: busy ? Math.max(0, current.attempts - 1) : current.attempts,
      error: message.slice(0, 1000), leasedUntil: null, leaseToken: null,
      availableAt: sql`now() + interval '15 seconds'`, completedAt: terminal ? new Date() : null,
    }).where(eq(generationJobs.id, current.id));
    if (terminal) {
      await releaseFunding(tx, current);
      const [intent] = await tx.select().from(generationIntents).where(eq(generationIntents.id, current.intentId));
      if (intent?.contributionId) await tx.update(loreContributions).set({ status: "failed" }).where(and(eq(loreContributions.id, intent.contributionId), sql`${loreContributions.status} <> 'succeeded'`));
    }
  });
}

export async function recoverExhaustedJobs() {
  const expired = await db.select().from(generationJobs).where(and(eq(generationJobs.status, "running"), sql`${generationJobs.attempts} >= 3`, sql`${generationJobs.leasedUntil} < now()`)).limit(20);
  for (const job of expired) await finishFailure(job, "Generation was interrupted after three attempts.", false, false, true);
}

export async function runJob(job: Job) {
  const heartbeat = setInterval(() => {
    void db.update(generationJobs).set({ leasedUntil: sql`now() + interval '2 minutes'`, progressUpdatedAt: new Date() })
      .where(and(eq(generationJobs.id, job.id), eq(generationJobs.leaseToken, job.leaseToken!), or(eq(generationJobs.status, "running"), eq(generationJobs.status, "succeeded"))))
      .catch(() => console.error("Could not renew generation lease:", job.id));
  }, 20000);
  try {
    const [intent] = await db.select().from(generationIntents).where(eq(generationIntents.id, job.intentId));
    if (!intent) throw new Error("The saved article request is unavailable.");
    const [contribution] = intent.contributionId ? await db.select().from(loreContributions).where(eq(loreContributions.id, intent.contributionId)) : [];
    if (intent.answer && (!contribution || contribution.answer !== intent.answer)) throw new Error("The saved contribution is unavailable.");
    const response = await generateArticleRequest(new Request("http://worker.internal/generate", {
      method: "POST", body: JSON.stringify({ wiki: intent.wiki, slug: intent.slug, title: intent.title, sourceSlug: intent.sourceSlug }),
    }), { contribution, onSaved: (tx, article) => completeJob(tx, job, article.id) });
    if (!response.ok) {
      const failure = await response.json();
      await finishFailure(job, failure.error || "Article generation could not start.", failure.exists === true, failure.busy === true);
      return;
    }
    // Draining the stream is local to the worker. Browser lifetimes do not own jobs.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let failure: string | undefined;
    let progress = emptyGenerationProgress();
    let lastPublished = 0;
    let checkpointLength = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line) as GenerationEvent;
        if (event.type === "error") failure = event.message;
        progress = applyGenerationEvent(progress, event);
        if (event.type === "delta") {
          // Include the short tail since the checkpoint for readers joining
          // between writes. Connected readers append only the new characters.
          await notifyGeneration(job, { offset: checkpointLength, text: progress.markdown.slice(checkpointLength) })
            .catch(() => console.error("Live generation update will recover from its checkpoint:", job.id));
        }
        if (event.type !== "delta" || Date.now() - lastPublished >= 400) {
          // Persist snapshots, not a browser-owned stream. Reconnecting readers
          // see the latest text and images without starting another generation.
          try {
            await publishGenerationProgress(job, progress);
            checkpointLength = progress.markdown.length;
            if (event.type !== "delta") await notifyGeneration(job);
          } catch { console.error("Could not publish generation preview:", job.id); }
          lastPublished = Date.now();
        }
      }
    }
    const [finished] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
    if (finished?.status !== "succeeded") await finishFailure(job, failure || "Generation ended before the article was saved.");
  } catch (error) {
    await finishFailure(job, error instanceof Error ? error.message : "Generation failed.");
  } finally {
    clearInterval(heartbeat);
  }
}

export async function existingArticle(intent: { wiki: string; slug: string }) {
  const [article] = await db.select({ id: articles.id }).from(articles).where(and(eq(articles.wiki, intent.wiki), eq(articles.slug, intent.slug))).limit(1);
  return article;
}
