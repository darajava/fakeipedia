import { linkedArticleSlugs } from "./wiki";

type ArticleReference = { slug: string; title: string; content: string };

// The stub's link defines its entry point; its filename can have a different name.
export function findWorldOverviewBrief(
  articles: ArticleReference[],
  wiki: string,
  targetSlug: string,
): ArticleReference | undefined {
  return articles.find((article) => {
    if (!article.slug.startsWith("stub-")) return false;
    const targets = linkedArticleSlugs(article.content, wiki);
    return targets.length === 1 && targets[0] === targetSlug;
  });
}
