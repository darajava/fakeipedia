import { ThemeToggle } from "@/components/theme-toggle";
import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import path from "node:path";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { and, eq, inArray } from "drizzle-orm";
import { WikiImage } from "@/components/wiki-image";
import { WikiCaption } from "@/components/wiki-caption";
import { WikipediaNote } from "@/components/wikipedia-note";
import { rehypeCodeLinks } from "@/lib/rehype-code-links";
import { extractArticleImages } from "@/lib/article-draft";
import { remarkSubjectInfobox } from "@/lib/remark-subject-infobox";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articleLink, articlePath, graphPath, imageSource, linkedArticleSlugs, prepareWikiLinks, wikiPath } from "@/lib/wiki";
import { DeleteArticleButton } from "./delete-article-button";
import { worldOverviewSlug } from "@/lib/world-overview";
import { readWikiDefinition } from "@/lib/wiki-files";
import "./wiki.css";

type WikiPageProps = {
  params: Promise<{ wiki: string; slug: string }>;
};

const getArticle = cache(async (wiki: string, slug: string) => {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.wiki, wiki), eq(articles.slug, slug.toLowerCase())))
    .limit(1);

  if (article?.slug.startsWith("stub-")) {
    const target = worldOverviewSlug(article, wiki);
    if (!target || target.startsWith("stub-")) notFound();
    const [main] = await db.select({ slug: articles.slug }).from(articles)
      .where(and(eq(articles.wiki, wiki), eq(articles.slug, target))).limit(1);
    // Old startup URLs still work, but the brief itself is never displayed.
    redirect(main ? articlePath(wiki, target)
      : `${articlePath(wiki, target)}/generate?title=${encodeURIComponent(article.title)}&source=${encodeURIComponent(article.slug)}`);
  }
  return article;
});

async function existingLinkedSlugs(markdown: string, wiki: string): Promise<Set<string>> {
  const linkedSlugs = linkedArticleSlugs(markdown, wiki);

  if (linkedSlugs.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ slug: articles.slug })
    .from(articles)
    .where(and(eq(articles.wiki, wiki), inArray(articles.slug, linkedSlugs)));

  return new Set(rows.map(({ slug }) => slug));
}

export async function generateMetadata({
  params,
}: WikiPageProps): Promise<Metadata> {
  const { wiki, slug } = await params;
  const article = await getArticle(wiki, slug);

  if (!article) {
    return { title: "Article not found — Fakeipedia" };
  }

  return {
    title: `${article.title} — Fakeipedia`,
  };
}

export default async function WikiPage({ params }: WikiPageProps) {
  const { wiki, slug } = await params;
  const article = await getArticle(wiki, slug);

  if (!article) {
    notFound();
  }

  const [existingSlugs, { mainPageSlug }] = await Promise.all([
    existingLinkedSlugs(article.content, wiki),
    readWikiDefinition(path.join(process.cwd(), "wiki-files"), wiki),
  ]);
  const retryableImages = extractArticleImages(article.content, article.slug);
  const markdown = prepareWikiLinks(article.content.replace(/^#\s+.+?(?:\r?\n)+/, ""), wiki);

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
            <Link href={graphPath(wiki)}>Article graph</Link>
            <Link href="/">All wikis</Link>
            <a href={`/random?wiki=${encodeURIComponent(wiki)}`}>Random article</a>
          </nav>
        </aside>

        <main className="wiki-main">
          <nav className="wiki-tabs" aria-label="Article actions">
            <span>Article</span>
            <span>Discussion</span>
            <span>Read</span>
            <Link href={`${articlePath(wiki, article.slug)}/edit`}>Edit</Link>
            <Link href={`${articlePath(wiki, article.slug)}/history`}>View history</Link>
            {process.env.NODE_ENV === "development" && (
              <DeleteArticleButton wiki={wiki} slug={article.slug} />
            )}
          </nav>

          <article className="wiki-article">
            <h1>{article.title}</h1>
            <p className="wiki-subtitle">
              From Fakeipedia, the fake encyclopedia
            </p>
            <Suspense fallback={null}>
              <WikipediaNote title={article.title} />
            </Suspense>

            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath, [remarkSubjectInfobox, { title: article.title, wiki, slug: article.slug }]]}
              rehypePlugins={[rehypeRaw, rehypeKatex, rehypeCodeLinks]}
              components={{
                a({ href, children, node: _node, className, ...props }) {
                  void _node;

                  const link = articleLink(href, wiki);
                  if (link?.slug.startsWith("stub-")) return <>{children}</>;
                  const isMissing = link?.wiki === wiki && !existingSlugs.has(link.slug);
                  const finalHref = isMissing && link
                    ? `${articlePath(wiki, link.slug)}/generate?title=${encodeURIComponent(link.title)}&source=${encodeURIComponent(article.slug)}${link.hash}`
                    : link?.href ?? href;

                  const linkClassName = [
                    className,
                    isMissing ? "wiki-link-missing" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <a
                      href={finalHref}
                      className={linkClassName || undefined}
                      {...props}
                    >
                      {children}
                    </a>
                  );
                },
                img({ src, alt, title, className, node: _node }) {
                  void _node;

                  const resolvedSource = imageSource(src as string, wiki);
                  const retryableImage = retryableImages.find((image) =>
                    imageSource(`./images/${image.filename}`, wiki) === resolvedSource,
                  );

                  if (!resolvedSource) {
                    return null;
                  }

                  return (
                    <WikiImage
                      src={resolvedSource}
                      alt={alt ?? ""}
                      caption={title ?? alt ?? ""}
                      captionContent={<WikiCaption text={title ?? alt ?? ""} wiki={wiki} slug={article.slug} existingSlugs={existingSlugs} />}
                      priority={className?.includes("wiki-subject-image")}
                      retryImage={retryableImage ? { wiki, slug: article.slug, filename: retryableImage.filename, prompt: retryableImage.description } : undefined}
                    />
                  );
                },
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}
