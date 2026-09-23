import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, titleFromSlug, wikiPath } from "@/lib/wiki";
import { discussionContributions } from "@/lib/discussion-contributions";
import { ThemeToggle } from "@/components/theme-toggle";
import "../wiki.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ wiki: string; slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { wiki, slug } = await params;
  const [article] = await db.select({ title: articles.title }).from(articles).where(and(eq(articles.wiki, wiki), eq(articles.slug, slug))).limit(1);
  return { title: `Discussion: ${article?.title ?? titleFromSlug(slug)} — Fakeipedia` };
}

export default async function DiscussionPage({ params }: Props) {
  const { wiki, slug } = await params;
  const [article] = await db.select().from(articles).where(and(eq(articles.wiki, wiki), eq(articles.slug, slug))).limit(1);
  const contributions = article ? await discussionContributions(article.id) : [];
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
          {article ? <Link href={articlePath(wiki, slug)}>Article</Link> : <span>Article</span>}
          <span aria-current="page">Discussion</span>
        </nav>
        <article className="wiki-article">
          <h1>Discussion: {article?.title ?? titleFromSlug(slug)}</h1>
          <p className="wiki-subtitle">Reader contributions that shaped this article</p>
          {contributions.length === 0 && <p>{article ? "No reader contribution was used to generate this article." : "This article has not been generated yet."}</p>}
          {contributions.map((contribution) => <section className="wiki-lore-contribution" key={contribution.id}>
            <p className="wiki-lore-answer">{contribution.answer}</p>
            <p className="wiki-subtitle">{contribution.handle || "Anonymous reader"} · <time dateTime={contribution.createdAt.toISOString()}>{contribution.createdAt.toLocaleDateString("en-IE", { dateStyle: "long", timeZone: "UTC" })}</time><br />
              From {contribution.sourceArticleId ? <Link href={articlePath(wiki, contribution.sourceSlug)}>{contribution.sourceTitle}</Link> : contribution.sourceTitle}
            </p>
          </section>)}
        </article>
      </main>
    </div>
  </div>;
}
