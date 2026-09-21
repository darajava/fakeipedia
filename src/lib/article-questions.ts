import { createHash } from "node:crypto";
import type { LinkQuestion } from "../db/schema";
import { articleLinkTargets } from "./wiki-graph";

export function questionContentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function questionTargets(source: { slug: string; content: string }, wiki: string) {
  return articleLinkTargets(source.content, wiki).filter((link) => link.slug !== source.slug && !link.slug.startsWith("stub-"));
}

export function fallbackQuestions(targets: Array<{ slug: string; title: string }>): LinkQuestion[] {
  return targets.map((target) => ({ ...target, question: `What would you like to add to the story of ${target.title}?` }));
}

export function parseLinkQuestions(text: string, targets: Array<{ slug: string; title: string }>): LinkQuestion[] {
  const data: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!Array.isArray(data) || data.length !== targets.length) throw new Error("The question list does not match the article's links.");
  const questions = new Map<string, string>();
  for (const value of data) {
    if (!value || typeof value.slug !== "string" || typeof value.question !== "string" ||
      !value.question.trim() || value.question.length > 600 || questions.has(value.slug) || !targets.some((target) => target.slug === value.slug)) {
      throw new Error("The question list contains invalid or duplicate targets.");
    }
    questions.set(value.slug, value.question.trim());
  }
  return targets.map((target) => ({ ...target, question: questions.get(target.slug)! }));
}
