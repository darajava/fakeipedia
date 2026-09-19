import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, titleFromSlug } from "@/lib/wiki";
import "./[slug]/wiki.css";

type WikiIndexProps = { params: Promise<{ wiki: string }> };

export async function generateMetadata({ params }: WikiIndexProps) {
  const { wiki } = await params;
  return { title: `${titleFromSlug(wiki)} — Fakeipedia` };
}

export default async function WikiIndex({ params }: WikiIndexProps) {
  const { wiki } = await params;
  const rows = await db.select({ slug: articles.slug, title: articles.title })
    .from(articles)
    .where(eq(articles.wiki, wiki))
    .orderBy(asc(articles.title));

  if (rows.length === 0) notFound();

  return (
    <div className="wiki-shell">
      <header className="wiki-header">
        <Link href="/" className="wiki-logo">Fakeipedia</Link>
        <Link href="/">All wikis</Link>
      </header>
      <main className="wiki-article" style={{ maxWidth: 1000, margin: "32px auto", borderTop: "1px solid var(--wiki-border)" }}>
        <h1>{titleFromSlug(wiki)}</h1>
        <p className="wiki-subtitle">{rows.length} {rows.length === 1 ? "article" : "articles"} in this world</p>
        <ul>
          {rows.map((article) => (
            <li key={article.slug}>
              <Link href={articlePath(wiki, article.slug)}>{article.title}</Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
