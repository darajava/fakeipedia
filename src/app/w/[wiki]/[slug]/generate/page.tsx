import { ThemeToggle } from "@/components/theme-toggle";
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { titleFromSlug, wikiPath } from "@/lib/wiki";

import { GenerateArticle } from "./generate-article";
import "../wiki.css";

import { db } from "@/db";
import { articles } from "@/db/schema";

type GeneratePageProps = {
  params: Promise<{
    wiki: string;
    slug: string;
  }>;
  searchParams: Promise<{
    title?: string;
    source?: string;
  }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: GeneratePageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  const title = query.title?.trim() || titleFromSlug(slug);

  return {
    title: `Generating ${title} — Fakeipedia`,
  };
}

export default async function GeneratePage({
  params,
  searchParams,
}: GeneratePageProps) {
  const [{ wiki, slug }, query] = await Promise.all([params, searchParams]);
  const sourceSlug = query.source?.trim() ?? "";

  const title = query.title?.trim() || titleFromSlug(slug);

  const existingArticles = await db
    .select({
      slug: articles.slug,
    })
    .from(articles)
    .where(eq(articles.wiki, wiki));

  const existingArticleSlugs = existingArticles.map((article) => article.slug);

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
        <aside className="wiki-sidebar">
          <nav aria-label="Wiki navigation">
            <Link href={wikiPath(wiki)}>Main page</Link>
            <Link href="/">All wikis</Link>
            <Link href="/random">Random article</Link>
          </nav>
        </aside>

        <main className="wiki-main">
          <nav className="wiki-tabs" aria-label="Article actions">
            <span>Article</span>
            <span>Discussion</span>
            <span>Generating</span>
          </nav>

          <article className="wiki-article">
            <GenerateArticle
              wiki={wiki}
              slug={slug}
              title={title}
              sourceSlug={sourceSlug}
              existingArticleSlugs={existingArticleSlugs}
            />
          </article>
        </main>
      </div>
    </div>
  );
}
