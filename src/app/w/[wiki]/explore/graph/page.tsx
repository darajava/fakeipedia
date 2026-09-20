import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { titleFromSlug, validSlug, wikiPath } from "@/lib/wiki";
import { WikiGraph } from "@/components/wiki-graph/wiki-graph";
import "../../[slug]/wiki.css";

type Props = { params: Promise<{ wiki: string }> };
export async function generateMetadata({ params }: Props) {
  const { wiki } = await params;
  return { title: `${titleFromSlug(wiki)} article graph — Fakeipedia` };
}
export default async function GraphPage({ params }: Props) {
  const { wiki } = await params;
  if (!validSlug(wiki)) notFound();
  const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.wiki, wiki)).limit(1);
  if (!rows.length) notFound();
  return <div className="wiki-shell">
    <header className="wiki-header">
      <Link href="/" className="wiki-logo">Fakeipedia</Link>
      <Link href={wikiPath(wiki)}>{titleFromSlug(wiki)}</Link>
      <ThemeToggle />
    </header>
    <main className="graph-page">
      <div className="graph-heading"><div><h1>{titleFromSlug(wiki)}: article graph</h1><p>Explore how this world connects.</p></div><Link href={wikiPath(wiki)}>Article list</Link></div>
      <WikiGraph key={wiki} wiki={wiki} />
    </main>
  </div>;
}
