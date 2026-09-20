import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { asc, count, notLike } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, wikiPath } from "@/lib/wiki";
import { readWikiDefinition } from "@/lib/wiki-files";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = await db
    .select({ wiki: articles.wiki, articleCount: count() })
    .from(articles)
    .where(notLike(articles.slug, "stub-%"))
    .groupBy(articles.wiki)
    .orderBy(asc(articles.wiki));
  const homepageOrder = (await readFile(path.join(process.cwd(), "homepage-order.txt"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const position = (wiki: string) => {
    const index = homepageOrder.indexOf(wiki);
    return index === -1 ? homepageOrder.length : index;
  };
  // Preserve the query's alphabetical order for wikis missing from the list.
  rows.sort((a, b) => position(a.wiki) - position(b.wiki));
  const wikis = await Promise.all(rows.map(async (row) => ({
    ...row,
    ...await readWikiDefinition(path.join(process.cwd(), "wiki-files"), row.wiki),
  })));

  return (
    <main className={styles.main}>
      <header className={styles.intro}>
        <div className={styles.topbar}>
          <p className={styles.wordmark}>Fakeipedia</p>
          <ThemeToggle />
        </div>
        <h1>Choose a Wiki</h1>
        <p>An encyclopedia of different worlds. Explore the histories, people, and peculiarities of an alternate reality.</p>
      </header>
      <nav className={styles.wikis} aria-label="Wikis">
        {wikis.map(({ wiki, articleCount, title, subtitle, mainPageSlug }) => (
          <Link key={wiki} href={mainPageSlug ? articlePath(wiki, mainPageSlug) : wikiPath(wiki)} className={styles.wiki}>
            <h2>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            <p className={styles.articleCount}>{articleCount} {articleCount === 1 ? "article" : "articles"}</p>
            <span>Explore →</span>
          </Link>
        ))}
      </nav>
      {wikis.length === 0 && <p>The first worlds are coming soon.</p>}
    </main>
  );
}
