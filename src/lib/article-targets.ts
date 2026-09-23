import { articleLinkTargets } from "./wiki-graph";

export function generationTargets(source: { slug: string; content: string }, wiki: string) {
  return articleLinkTargets(source.content, wiki).filter((link) => link.slug !== source.slug && !link.slug.startsWith("stub-"));
}
