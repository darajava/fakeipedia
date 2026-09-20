import { linkedArticleSlugs } from "./wiki";

type ArticleReference = { slug: string; title: string; content: string };

export function worldOverviewSlug(article: ArticleReference, wiki: string): string | undefined {
  if (!article.slug.startsWith("stub-")) return undefined;
  // Briefs can also contain suggested links; the explicit target takes priority.
  const targetSection = article.content.split(/^##[ \t]+Target article[ \t]*\r?\n/im)[1]
    ?.split(/^##[ \t]+/m)[0];
  const targets = linkedArticleSlugs(targetSection ?? article.content, wiki);
  return targets.length === 1 ? targets[0] : undefined;
}

// The stub's link defines its entry point; its filename can have a different name.
export function findWorldOverviewBrief(
  articles: ArticleReference[],
  wiki: string,
  targetSlug: string,
): ArticleReference | undefined {
  return articles.find((article) => worldOverviewSlug(article, wiki) === targetSlug);
}
