import Link from "next/link";
import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { titleFromSlug, wikiPath } from "@/lib/wiki";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const wikis = await db
    .select({ wiki: articles.wiki, articleCount: count() })
    .from(articles)
    .groupBy(articles.wiki)
    .orderBy(asc(articles.wiki));

  return (
    <main className={styles.main}>
      <header className={styles.intro}>
        <p className={styles.wordmark}>Fakeipedia</p>
        <h1>Choose a world.</h1>
        <p>An encyclopedia of places that never were. Explore the histories,
          people, and peculiarities of a different world.</p>
      </header>
      <nav className={styles.wikis} aria-label="Wikis">
        {wikis.map(({ wiki, articleCount }) => (
          <Link key={wiki} href={wikiPath(wiki)} className={styles.wiki}>
            <h2>{titleFromSlug(wiki)}</h2>
            <p>{articleCount} {articleCount === 1 ? "article" : "articles"}</p>
            <span>Explore this world →</span>
          </Link>
        ))}
      </nav>
      {wikis.length === 0 && <p>The first worlds are coming soon.</p>}
    </main>
  );
}
