import { Suspense } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { WikiImage } from "@/components/wiki-image";
import { WikiCaption } from "@/components/wiki-caption";
import { WikiTable } from "@/components/wiki-table";
import { WikipediaNote } from "@/components/wikipedia-note";
import { rehypeCodeLinks } from "@/lib/rehype-code-links";
import { extractArticleImages } from "@/lib/article-draft";
import { remarkSubjectInfobox } from "@/lib/remark-subject-infobox";
import { articleLink, articlePath, imageSource } from "@/lib/wiki";
import { prepareArticleMarkdown, rehypeArticleHeadings } from "@/lib/article-headings";
import { articleImageStates } from "@/lib/article-image-status";

type Props = {
  wiki: string;
  article: { slug: string; title: string; content: string };
  existingSlugs: ReadonlySet<string>;
};

/** Shared published-article presentation, including images, tables and red links. */
export async function WikiArticleContent({ wiki, article, existingSlugs }: Props) {
  const retryableImages = extractArticleImages(article.content, article.slug);
  const imageStates = await articleImageStates(wiki, article);
  const markdown = prepareArticleMarkdown(article.content, wiki);
  return <>
    <h1>{article.title}</h1>
    <p className="wiki-subtitle">
      From Fakeipedia, the fake encyclopedia
    </p>
    <Suspense fallback={null}>
      <WikipediaNote title={article.title} />
    </Suspense>

    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, [remarkSubjectInfobox, { title: article.title, wiki, slug: article.slug }]]}
      rehypePlugins={[rehypeRaw, rehypeArticleHeadings, rehypeKatex, rehypeCodeLinks]}
      components={{
        table: WikiTable,
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
              generating={Boolean(retryableImage && imageStates[retryableImage.filename]?.state === "pending")}
              retryImage={retryableImage ? { wiki, slug: article.slug, filename: retryableImage.filename, prompt: retryableImage.description } : undefined}
            />
          );
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  </>;
}
