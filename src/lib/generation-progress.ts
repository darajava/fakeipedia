import type { ArticleImageMessage } from "./article-images";

export type GenerationProgress = {
  markdown: string;
  readyImages: Record<string, string>;
  failedImages: Record<string, boolean>;
  phase: "writing" | "images" | "done";
};
export type GenerationEvent = ArticleImageMessage
  | { type: "delta"; delta: string }
  | { type: "text-done"; markdown: string }
  | { type: "done"; slug: string }
  | { type: "error"; message: string };

export function emptyGenerationProgress(): GenerationProgress {
  return { markdown: "", readyImages: {}, failedImages: {}, phase: "writing" };
}
export function applyGenerationEvent(progress: GenerationProgress, event: GenerationEvent): GenerationProgress {
  switch (event.type) {
    case "delta": return { ...progress, markdown: progress.markdown + event.delta };
    case "text-done": return { ...progress, markdown: event.markdown, phase: "images" };
    case "images-start": return { ...progress, phase: "images" };
    case "image-done": return { ...progress, readyImages: { ...progress.readyImages, [event.filename]: event.url } };
    case "image-error": return { ...progress, failedImages: { ...progress.failedImages, [event.filename]: true } };
    case "done": return { ...progress, phase: "done" };
    default: return progress;
  }
}

export function generationPreviewComplete(job: { status: string; progress: GenerationProgress | null; progressUpdatedAt: Date | null }, now = Date.now()) {
  // Older jobs have no preview. If a worker stops after committing article text,
  // open that saved article rather than leaving the reader waiting on images.
  return job.status === "succeeded" && (!job.progress || job.progress.phase === "done" || !job.progressUpdatedAt || now - job.progressUpdatedAt.getTime() > 120000);
}
