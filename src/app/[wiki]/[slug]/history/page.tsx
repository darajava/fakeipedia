import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, wikiPath } from "@/lib/wiki";
import { ThemeToggle } from "@/components/theme-toggle";
import "../wiki.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ wiki: string; slug: string }> };

const getArticle = cache(async (wiki: string, slug: string) => {
  const [article] = await db.select({ title: articles.title, slug: articles.slug })
    .from(articles).where(and(eq(articles.wiki, wiki), eq(articles.slug, slug.toLowerCase()))).limit(1);
  if (!article) notFound();
  return article;
});

export async function generateMetadata({ params }: Props) {
  const { wiki, slug } = await params;
  const article = await getArticle(wiki, slug);
  return { title: `History: ${article.title} — Fakeipedia` };
}

export default async function HistoryPage({ params }: Props) {
  const { wiki, slug } = await params;
  const article = await getArticle(wiki, slug);
  const href = articlePath(wiki, article.slug);

  return <div className="wiki-shell">
    <header className="wiki-header">
      <Link href="/" className="wiki-logo">Fakeipedia</Link>
      <form action="/search" method="get" className="wiki-search">
        <input type="search" name="q" aria-label="Search Fakeipedia" placeholder="Search Fakeipedia" /><button type="submit">Search</button>
      </form>
      <ThemeToggle />
    </header>
    <div className="wiki-layout">
      <aside className="wiki-sidebar"><nav aria-label="Wiki navigation"><Link href={wikiPath(wiki)}>Main page</Link><Link href="/">All wikis</Link></nav></aside>
      <main className="wiki-main">
        <nav className="wiki-tabs" aria-label="Article actions">
          <Link href={href}>Article</Link>
          <Link href={`${href}/discussion`}>Discussion</Link>
          <Link href={href}>Read</Link>
          <span aria-current="page">View history</span>
        </nav>
        <article className="wiki-article">
          <h1>History: {article.title}</h1>
          <p>This article has no history.</p>
        </article>
      </main>
    </div>
  </div>;
}
