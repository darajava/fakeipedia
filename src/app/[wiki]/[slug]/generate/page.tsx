import { ThemeToggle } from "@/components/theme-toggle";
import type { Metadata } from "next";
import Link from "next/link";
import path from "node:path";
import { eq } from "drizzle-orm";
import { articlePath, titleFromSlug, wikiPath } from "@/lib/wiki";
import { readWikiDefinition } from "@/lib/wiki-files";

import { PrepareArticle } from "./prepare-article";
import { headers } from "next/headers";
import { requestCurrency } from "@/lib/request-currency";
import { redirect } from "next/navigation";
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
    intent?: string;
  }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: GeneratePageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  const title = query.title?.trim() || titleFromSlug(slug);

  return {
    title: `Shape ${title} — Fakeipedia`,
  };
}

export default async function GeneratePage({
  params,
  searchParams,
}: GeneratePageProps) {
  const [{ wiki, slug }, query] = await Promise.all([params, searchParams]);
  const sourceSlug = query.source?.trim() ?? "";

  const title = query.title?.trim() || titleFromSlug(slug);

  const [existingArticles, { mainPageSlug }] = await Promise.all([
    db
      .select({
        slug: articles.slug,
        title: articles.title,
      })
      .from(articles)
      .where(eq(articles.wiki, wiki)),
    readWikiDefinition(path.join(process.cwd(), "wiki-files"), wiki),
  ]);

  const existingArticleSlugs = existingArticles.map((article) => article.slug);
  if (existingArticleSlugs.includes(slug) && !query.intent) redirect(articlePath(wiki, slug));

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
            <Link href={mainPageSlug ? articlePath(wiki, mainPageSlug) : wikiPath(wiki)}>Main page</Link>
            <Link href="/">All wikis</Link>
            <a href={`/random?wiki=${encodeURIComponent(wiki)}`}>Random article</a>
          </nav>
        </aside>

        <main className="wiki-main">
          <nav className="wiki-tabs" aria-label="Article actions">
            <span>Article</span>
            <Link href={`${articlePath(wiki, slug)}/discussion`}>Discussion</Link>
            <span>Creation</span>
          </nav>

          <div className="wiki-article">
            <PrepareArticle
              key={`${wiki}/${slug}/${sourceSlug}`}
              currency={requestCurrency(await headers())}
              wiki={wiki}
              slug={slug}
              title={title}
              sourceSlug={sourceSlug}
              initialIntentId={query.intent}
              existingArticleSlugs={existingArticleSlugs}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
