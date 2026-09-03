import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { eq, inArray } from "drizzle-orm";
import { WikiImage } from "@/components/wiki-image";
import { db } from "@/db";
import { articles } from "@/db/schema";
import "./wiki.css";

type WikiPageProps = {
  params: Promise<{ slug: string }>;
};

const getArticle = cache(async (slug: string) => {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.slug, slug.toLowerCase()))
    .limit(1);

  return article;
});

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function prepareMarkdown(markdown: string): string {
  return markdown
    .replace(/^#\s+.+?(?:\r?\n)+/, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target: string, label?: string) => {
        const cleanTarget = target.trim();
        const cleanLabel = label?.trim() || cleanTarget;

        return `[${cleanLabel}](/wiki/${slugify(
          cleanTarget,
        )}?title=${encodeURIComponent(cleanTarget)})`;
      },
    );
}

function linkedArticleSlugs(markdown: string): string[] {
  const slugs = new Set<string>();

  for (const match of markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const slug = slugify(match[1]);
    if (slug) slugs.add(slug);
  }

  for (const match of markdown.matchAll(
    /\[[^\]]+\]\(\/wiki\/([^\s)#?]+)[^)]*\)/g,
  )) {
    slugs.add(match[1].toLowerCase());
  }

  for (const match of markdown.matchAll(
    /href=["']\/wiki\/([^"'#?]+)[^"']*["']/g,
  )) {
    slugs.add(match[1].toLowerCase());
  }

  return [...slugs];
}

async function existingLinkedSlugs(markdown: string): Promise<Set<string>> {
  const linkedSlugs = linkedArticleSlugs(markdown);

  if (linkedSlugs.length === 0) {
    return new Set();
  }

  const rows = await db
    .select({ slug: articles.slug })
    .from(articles)
    .where(inArray(articles.slug, linkedSlugs));

  return new Set(rows.map(({ slug }) => slug));
}

function imageSource(source?: string): string | undefined {
  if (!source?.startsWith("./images/")) {
    return source;
  }

  const relativePath = source.slice("./images/".length);
  const encodedPath = relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `/wiki-images/${encodedPath}`;
}

export async function generateMetadata({
  params,
}: WikiPageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);

  if (!article) {
    return { title: "Article not found — Fakeipedia" };
  }

  return {
    title: `${article.title} — Fakeipedia`,
  };
}

export default async function WikiPage({ params }: WikiPageProps) {
  const { slug } = await params;
  const article = await getArticle(slug);

  if (!article) {
    notFound();
  }

  const existingSlugs = await existingLinkedSlugs(article.content);
  const markdown = prepareMarkdown(article.content);

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
      </header>

      <div className="wiki-layout">
        <aside className="wiki-sidebar">
          <nav aria-label="Wiki navigation">
            <Link href="/">Main page</Link>
            <Link href="/random">Random article</Link>
          </nav>
        </aside>

        <main className="wiki-main">
          <nav className="wiki-tabs" aria-label="Article actions">
            <span>Article</span>
            <span>Discussion</span>
            <span>Read</span>
            <Link href={`/wiki/${article.slug}/edit`}>Edit</Link>
            <Link href={`/wiki/${article.slug}/history`}>View history</Link>
          </nav>

          <article className="wiki-article">
            <h1>{article.title}</h1>
            <p className="wiki-subtitle">
              From Fakeipedia, the fake encyclopedia
            </p>

            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a({ href, children, node: _node, className, ...props }) {
                  void _node;

                  const wikiUrl = href?.startsWith("/wiki/")
                    ? new URL(href, "http://fakeipedia.local")
                    : undefined;

                  const linkedSlug = wikiUrl
                    ? wikiUrl.pathname
                        .slice("/wiki/".length)
                        .split("/")[0]
                        .toLowerCase()
                    : undefined;

                  const isMissing =
                    linkedSlug !== undefined && !existingSlugs.has(linkedSlug);

                  const targetTitle =
                    wikiUrl?.searchParams.get("title") ??
                    linkedSlug
                      ?.split("-")
                      .map((word) => word[0]?.toUpperCase() + word.slice(1))
                      .join(" ");

                  const finalHref =
                    isMissing && linkedSlug
                      ? `/wiki/${linkedSlug}/generate?title=${encodeURIComponent(
                          targetTitle ?? linkedSlug,
                        )}&source=${encodeURIComponent(article.slug)}`
                      : href;

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
                img({ src, alt, title, node: _node }) {
                  void _node;

                  const resolvedSource = imageSource(src as string);

                  if (!resolvedSource) {
                    return null;
                  }

                  return (
                    <WikiImage
                      src={resolvedSource}
                      alt={alt ?? ""}
                      caption={title ?? alt ?? ""}
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
