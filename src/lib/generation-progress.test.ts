import assert from "node:assert/strict";
import test from "node:test";
import { applyGenerationEvent, emptyGenerationProgress, generationPreviewComplete } from "./generation-progress";

test("a reconnectable preview accumulates text and replaces it with the saved article", () => {
  let progress = emptyGenerationProgress();
  progress = applyGenerationEvent(progress, { type: "delta", delta: "# A" });
  progress = applyGenerationEvent(progress, { type: "delta", delta: " town\n\nDraft" });
  assert.equal(progress.markdown, "# A town\n\nDraft");
  progress = applyGenerationEvent(progress, { type: "text-done", markdown: "# A town\n\nFinal" });
  assert.equal(progress.markdown, "# A town\n\nFinal");
  assert.equal(progress.phase, "images");
  progress = applyGenerationEvent(progress, { type: "image-done", filename: "town_a.png", url: "/image/a" });
  progress = applyGenerationEvent(progress, { type: "image-error", filename: "town_b.png", message: "Unavailable" });
  assert.deepEqual(progress.readyImages, { "town_a.png": "/image/a" });
  assert.deepEqual(progress.failedImages, { "town_b.png": true });
  assert.equal(applyGenerationEvent(progress, { type: "done", slug: "town" }).phase, "done");
  assert.equal(emptyGenerationProgress().markdown, "", "A new attempt must not append to the failed draft");
});

test("committed article text stays in preview until images finish, with recovery after worker interruption", () => {
  const now = Date.now();
  const job = { status: "succeeded", progress: { ...emptyGenerationProgress(), phase: "images" as const }, progressUpdatedAt: new Date(now) };
  assert.equal(generationPreviewComplete(job, now), false);
  assert.equal(generationPreviewComplete({ ...job, progress: { ...job.progress, phase: "done" } }, now), true);
  assert.equal(generationPreviewComplete(job, now + 120001), true);
  assert.equal(generationPreviewComplete({ ...job, progress: null }, now), true);
  assert.equal(generationPreviewComplete({ ...job, status: "running" }, now + 120001), false);
});
