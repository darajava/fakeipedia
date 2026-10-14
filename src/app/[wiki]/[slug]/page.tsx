import { WikiArticleContent } from "@/components/wiki-article-content";
import { WikiTableOfContents } from "@/components/wiki-table-of-contents";
import { articleHeadings, prepareArticleMarkdown } from "@/lib/article-headings";
import { ThemeToggle } from "@/components/theme-toggle";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import path from "node:path";
import { notFound, redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, graphPath, wikiPath } from "@/lib/wiki";
import { DeleteArticleButton } from "./delete-article-button";
import { graphArticleLinks } from "@/lib/wiki-graph";
import { worldOverviewSlug } from "@/lib/world-overview";
import { readWikiDefinition } from "@/lib/wiki-files";
import "./wiki.css";

type WikiPageProps = {
  params: Promise<{ wiki: string; slug: string }>;
};

const getArticle = cache(async (wiki: string, slug: string) => {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.wiki, wiki), eq(articles.slug, slug.toLowerCase())))
    .limit(1);

  if (article?.slug.startsWith("stub-")) {
    const target = worldOverviewSlug(article, wiki);
    if (!target || target.startsWith("stub-")) notFound();
    const [main] = await db.select({ slug: articles.slug }).from(articles)
      .where(and(eq(articles.wiki, wiki), eq(articles.slug, target))).limit(1);
    // Old startup URLs still work, but the brief itself is never displayed.
    redirect(main ? articlePath(wiki, target)
      : `${articlePath(wiki, target)}/generate?title=${encodeURIComponent(article.title)}&source=${encodeURIComponent(article.slug)}`);
  }
  return article;
});

async function existingLinkedSlugs(markdown: string, wiki: string): Promise<Set<string>> {
  const linkedSlugs = graphArticleLinks(markdown, wiki);

  if (linkedSlugs.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ slug: articles.slug })
    .from(articles)
    .where(and(eq(articles.wiki, wiki), inArray(articles.slug, linkedSlugs)));

  return new Set(rows.map(({ slug }) => slug));
}

export async function generateMetadata({
  params,
}: WikiPageProps): Promise<Metadata> {
  const { wiki, slug } = await params;
  const article = await getArticle(wiki, slug);

  if (!article) {
    return { title: "Article not found — Fakeipedia" };
  }

  return {
    title: `${article.title} — Fakeipedia`,
  };
}

export default async function WikiPage({ params }: WikiPageProps) {
  const { wiki, slug } = await params;
  const article = await getArticle(wiki, slug);

  if (!article) {
    notFound();
  }

  const [existingSlugs, { mainPageSlug }] = await Promise.all([
    existingLinkedSlugs(article.content, wiki),
    readWikiDefinition(path.join(process.cwd(), "wiki-files"), wiki),
  ]);

  return (
    <div className="wiki-shell">
      <header className="wiki-header">
        <Link href="/" className="wiki-logo">
          Fakeipedia
        </Link>

        <form action="/search" method="get" className="wiki-search">
          <input
            type="search"
            name="q"
            aria-label="Search Fakeipedia"
            placeholder="Search Fakeipedia"
          />
          <button type="submit">Search</button>
        </form>
        <ThemeToggle />
      </header>

      <div className="wiki-layout">
        <aside className="wiki-sidebar wiki-article-sidebar">
          <nav aria-label="Wiki navigation">
            <Link href={mainPageSlug ? articlePath(wiki, mainPageSlug) : wikiPath(wiki)}>Main page</Link>
            <Link href={graphPath(wiki)}>Article graph</Link>
            <Link href="/">All wikis</Link>
            <a href={`/random?wiki=${encodeURIComponent(wiki)}`}>Random article</a>
          </nav>
          <WikiTableOfContents headings={articleHeadings(prepareArticleMarkdown(article.content, wiki))} />
        </aside>

        <main className="wiki-main">
          <nav className="wiki-tabs" aria-label="Article actions">
            <span>Article</span>
            <Link href={`${articlePath(wiki, article.slug)}/discussion`}>Discussion</Link>
            <span>Read</span>
            <Link href={`${articlePath(wiki, article.slug)}/history`}>View history</Link>
            {process.env.NODE_ENV === "development" && (
              <DeleteArticleButton wiki={wiki} slug={article.slug} />
            )}
          </nav>

          <article className="wiki-article">
            <WikiArticleContent wiki={wiki} article={article} existingSlugs={existingSlugs} />
          </article>
        </main>
      </div>
    </div>
  );
}
