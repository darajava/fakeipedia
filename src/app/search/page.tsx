import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { searchArticles } from "@/lib/search";
import { articlePath, titleFromSlug, wikiPath } from "@/lib/wiki";
import "../[wiki]/[slug]/wiki.css";
import "./search.css";

export const metadata: Metadata = { title: "Search — Fakeipedia" };
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const { q, total, page, pages, results } = await searchArticles(
    Array.isArray(params.q) ? params.q[0] : params.q ?? "",
    Array.isArray(params.page) ? params.page[0] : params.page,
  );
  const pageHref = (page: number) => `/search?${new URLSearchParams({ q, page: String(page) })}`;

  return (
    <div className="wiki-shell">
      <header className="wiki-header">
        <Link href="/" className="wiki-logo">Fakeipedia</Link>
        <form action="/search" method="get" className="wiki-search" role="search">
          <input type="search" name="q" aria-label="Search Fakeipedia" placeholder="Search Fakeipedia" defaultValue={q} maxLength={200} />
          <button type="submit">Search</button>
        </form>
        <ThemeToggle />
      </header>
      <main className="wiki-article wiki-search-results">
        <h1>Search</h1>
        <p><Link href="/">All wikis</Link></p>
        {!q ? (
          <p>Enter a search term to find articles across all wikis.</p>
        ) : total === 0 ? (
          <p>No articles found for “{q}”. Try a different name or keyword.</p>
        ) : (
          <>
            <p className="wiki-subtitle">{total.toLocaleString()} {total === 1 ? "result" : "results"} for “{q}” across all wikis</p>
            <ol className="wiki-search-result-list" start={(page - 1) * 20 + 1}>
              {results.map((article) => (
                <li key={`${article.wiki}/${article.slug}`}>
                  <h2><Link href={articlePath(article.wiki, article.slug)} prefetch={false}>{article.title}</Link></h2>
                  <p>Wiki: <Link href={wikiPath(article.wiki)}>{titleFromSlug(article.wiki)}</Link></p>
                </li>
              ))}
            </ol>
            {pages > 1 && (
              <nav className="wiki-search-pagination" aria-label="Search result pages">
                {page > 1 && <Link href={pageHref(page - 1)}>Previous</Link>}
                <span>Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
                {page < pages && <Link href={pageHref(page + 1)}>Next</Link>}
              </nav>
            )}
          </>
        )}
      </main>
    </div>
  );
}
