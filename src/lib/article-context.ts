import { graphArticleLinks } from "./wiki-graph";
import { worldOverviewSlug } from "./world-overview";

type ArticleReference = { title: string; slug: string; content: string };

export function buildArticleContext(
  articles: ArticleReference[],
  wiki: string,
  targetSlug: string,
  source: ArticleReference,
) {
  // The route supplies only articles from this wiki, ordered by title and slug.
  const referringArticles = [source, ...articles.filter((article) =>
    article.slug !== source.slug && graphArticleLinks(article.content, wiki).includes(targetSlug),
  )].slice(0, 10);
  const mainSlug = articles.map((article) => worldOverviewSlug(article, wiki))
    .find((slug) => slug !== undefined) ?? wiki;
  const mainArticle = articles.find((article) => article.slug === mainSlug && !article.slug.startsWith("stub-"));

  const catalogue = articles.map((article) =>
    `- Title: ${article.title}\n  Slug: ${article.slug}`,
  ).join("\n");
  const referringText = referringArticles.map((article, index) =>
    `Article title: ${article.title}\nArticle slug: ${article.slug}\nRole: ${index === 0 ? "Source article" : "Linking article"}\n\n<referring_article>\n${article.content}\n</referring_article>`,
  ).join("\n\n");
  const mainText = mainArticle
    ? `MAIN PAGE:\n\nArticle title: ${mainArticle.title}\nArticle slug: ${mainArticle.slug}\n\n${
      referringArticles.some((article) => article.slug === mainArticle.slug)
        ? "The complete main page is included among the referring articles above."
        : `<main_page>\n${mainArticle.content}\n</main_page>`
    }`
    : "";

  return { catalogue, referringText, mainText };
}
