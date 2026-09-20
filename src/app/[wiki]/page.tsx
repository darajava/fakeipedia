import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, notLike } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, graphPath, titleFromSlug, wikiPath } from "@/lib/wiki";
import "./[slug]/wiki.css";

type WikiIndexProps = { params: Promise<{ wiki: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: WikiIndexProps) {
  const { wiki } = await params;
  return { title: `${titleFromSlug(wiki)} — Fakeipedia` };
}

export default async function WikiIndex({ params, searchParams }: WikiIndexProps) {
  const { wiki } = await params;
  const { page: requestedPage } = await searchParams;
  const visibleArticles = and(eq(articles.wiki, wiki), notLike(articles.slug, "stub-%"));
  const [{ total }] = await db.select({ total: count() }).from(articles).where(visibleArticles);
  if (!total) notFound();
  const pages = Math.ceil(total / 100);
  const page = Math.min(pages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  const rows = await db.select({ slug: articles.slug, title: articles.title })
    .from(articles)
    .where(visibleArticles)
    .orderBy(asc(articles.title), asc(articles.slug))
    .limit(100).offset((page - 1) * 100);

  return (
    <div className="wiki-shell">
      <header className="wiki-header">
        <Link href="/" className="wiki-logo">Fakeipedia</Link>
        <Link href="/">All wikis</Link>
        <ThemeToggle />
      </header>
      <main className="wiki-article" style={{ maxWidth: 1000, margin: "32px auto", borderTop: "1px solid var(--wiki-border)" }}>
        <h1>{titleFromSlug(wiki)}</h1>
        <p className="wiki-subtitle">{total.toLocaleString()} {total === 1 ? "article" : "articles"} in this world</p>
        <p><Link href={graphPath(wiki)}>Explore the article graph →</Link></p>
        <ul>
          {rows.map((article) => (
            <li key={article.slug}>
              <Link href={articlePath(wiki, article.slug)} prefetch={false}>{article.title}</Link>
            </li>
          ))}
        </ul>
        {pages > 1 && <nav aria-label="Article list pages" style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {page > 1 && <Link href={`${wikiPath(wiki)}?page=${page - 1}`}>Previous</Link>}
          <span>Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
          {page < pages && <Link href={`${wikiPath(wiki)}?page=${page + 1}`}>Next</Link>}
        </nav>}
      </main>
    </div>
  );
}
