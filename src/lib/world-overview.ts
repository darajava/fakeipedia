import { articleLink, prepareWikiLinks } from "./wiki";

type ArticleReference = { slug: string; title: string; content: string };

export function worldOverviewTarget(article: ArticleReference, wiki: string) {
  if (!article.slug.startsWith("stub-")) return undefined;
  // Preserve occurrence order, including repeated links: the last link wins.
  const links = [...prepareWikiLinks(article.content, wiki).matchAll(
    /\[[^\]]*\]\((\/[^\s)]+)[^)]*\)|href=["'](\/[^"']+)["']/g,
  )];
  const last = links.at(-1);
  const target = last ? articleLink(last[1] ?? last[2], wiki) : undefined;
  return target?.wiki === wiki && !target.slug.startsWith("stub-") ? target : undefined;
}

export function worldOverviewSlug(article: ArticleReference, wiki: string): string | undefined {
  return worldOverviewTarget(article, wiki)?.slug;
}

// The stub's link defines its entry point; its filename can have a different name.
export function findWorldOverviewBrief(
  articles: ArticleReference[],
  wiki: string,
  targetSlug: string,
): ArticleReference | undefined {
  return articles.find((article) => worldOverviewSlug(article, wiki) === targetSlug);
}
