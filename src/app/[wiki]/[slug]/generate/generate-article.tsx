"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { articleLink, articlePath, prepareWikiLinks } from "@/lib/wiki";
import { WikiImage } from "@/components/wiki-image";
import { WikiCaption } from "@/components/wiki-caption";
import { rehypeCodeLinks } from "@/lib/rehype-code-links";
import { remarkSubjectInfobox } from "@/lib/remark-subject-infobox";
import type { ArticleImageMessage } from "@/lib/article-images";

const loadingMessages = [
  "Generating article",
  "Organising sections",
  "Considering history",
];

type GenerateArticleProps = {
  wiki: string;
  slug: string;
  title: string;
  sourceSlug: string;
  existingArticleSlugs: string[];
};

type StreamMessage =
  | ArticleImageMessage
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "text-done";
    }
  | {
      type: "done";
      slug: string;
    }
  | {
      type: "error";
      message: string;
    };

export function GenerateArticle({
  wiki,
  slug,
  title,
  sourceSlug,
  existingArticleSlugs,
}: GenerateArticleProps) {
  const router = useRouter();
  const started = useRef(false);

  const [markdown, setMarkdown] = useState("");
  const [, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const isWaitingForArticle = !markdown && !error;
  const loadingMessage = loadingMessages[loadingMessageIndex];

  useEffect(() => {
    if (!isWaitingForArticle) return;

    const interval = window.setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % loadingMessages.length);
    }, 7000);

    return () => window.clearInterval(interval);
  }, [isWaitingForArticle]);

  const [readyImages, setReadyImages] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  /*
   * Construct this once instead of querying the database
   * or rebuilding the Set for every streamed token.
   */
  const existingSlugs = useMemo(
    () =>
      new Set(
        existingArticleSlugs.map((articleSlug) => articleSlug.toLowerCase()),
      ),
    [existingArticleSlugs],
  );

  /*
   * Keeping this object stable prevents ReactMarkdown from
   * remounting image placeholders for every streamed token.
   *
   * The image animation will therefore continue uninterrupted.
   */
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ href, children, className, node: _node, ...props }) {
        void _node;
        const link = articleLink(href, wiki);
        if (link?.slug.startsWith("stub-")) return <>{children}</>;

        const isMissing =
          link?.wiki === wiki && !existingSlugs.has(link.slug);
        const destination = isMissing && link
          ? `${articlePath(wiki, link.slug)}/generate?title=${encodeURIComponent(link.title)}&source=${encodeURIComponent(slug)}${link.hash}`
          : link?.href ?? href;

        const linkClassName = [
          className,
          isMissing ? "wiki-link-missing" : undefined,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <a href={destination} className={linkClassName || undefined} {...props}>
            {children}
          </a>
        );
      },

      img({ src, alt, title, className }) {
        const filename = imageFilename(src as string);

        const completedUrl = filename ? readyImages[filename] : undefined;
        const captionContent = <WikiCaption text={title ?? alt ?? ""} wiki={wiki} slug={slug} existingSlugs={existingSlugs} />;

        if (filename && !completedUrl && !failedImages[filename]) {
          return (
            <span className="wiki-image-frame wiki-image-generating">
              <span className="wiki-image-loading-area">
                <span className="wiki-loading-spinner" aria-hidden="true" />

                <span>Generating image…</span>
              </span>

              <span className="wiki-image-caption"><span>{captionContent}</span></span>
            </span>
          );
        }

        if (!src) {
          return null;
        }

        return (
          <WikiImage
            src={(completedUrl as string) ?? src}
            alt={alt ?? ""}
            caption={title ?? alt ?? ""}
            captionContent={captionContent}
            priority={className?.includes("wiki-subject-image")}
            unavailable={Boolean(filename && failedImages[filename])}
            retryImage={filename ? { wiki, slug, filename, prompt: alt ?? "" } : undefined}
          />
        );
      },
    }),
    [existingSlugs, readyImages, failedImages, wiki, slug],
  );

  useEffect(() => {
    if (started.current) {
      return;
    }

    started.current = true;

    async function generate() {
      try {
        const response = await fetch("/api/articles/generate", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            wiki,
            slug,
            title,
            sourceSlug,
          }),
        });

        if (response.status === 409) {
          router.replace(articlePath(wiki, slug));
          router.refresh();
          return;
        }

        if (!response.ok || !response.body) {
          const result = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          throw new Error(
            result?.error ?? "Could not start article generation.",
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();

          buffer += decoder.decode(value, {
            stream: !done,
          });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }

            const message = JSON.parse(line) as StreamMessage;

            if (message.type === "delta") {
              setMarkdown((current) => current + message.delta);
            }

            if (message.type === "error") {
              throw new Error(message.message);
            }

            if (message.type === "text-done") {
              setStatus("Article written. Generating images…");
            }

            if (message.type === "images-start") {
              setStatus(
                `Generating ${message.count} ${
                  message.count === 1 ? "image" : "images"
                }…`,
              );
            }

            if (message.type === "image-start") {
              setStatus(
                `Generating image ${message.index} of ${message.count}…`,
              );
            }

            if (message.type === "image-done") {
              setReadyImages((current) => ({
                ...current,
                [message.filename]: message.url,
              }));
            }

            if (message.type === "image-error") {
              setFailedImages((current) => ({
                ...current,
                [message.filename]: true,
              }));
            }

            if (message.type === "done") {
              setStatus("Article saved. Opening it…");

              router.replace(articlePath(wiki, message.slug));

              router.refresh();
              return;
            }
          }

          if (done) {
            break;
          }
        }

        throw new Error("The generation stream ended unexpectedly.");
      } catch (caughtError) {
        setStatus("Generation failed.");

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unknown generation error.",
        );
      }
    }

    void generate();
  }, [router, wiki, slug, title, sourceSlug]);

  return (
    <section className="wiki-generator" aria-busy={!error}>
      {error ? (
        <div className="wiki-generation-error">
          <p>{error}</p>

          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      ) : (
        <article className="wiki-article wiki-generation-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, [remarkSubjectInfobox, { title, wiki, slug }]]}
            rehypePlugins={[rehypeRaw, rehypeKatex, rehypeCodeLinks]}
            components={markdownComponents}
          >
            {prepareWikiLinks(markdown, wiki)}
          </ReactMarkdown>

          {!markdown && (
            <div
              className="wiki-loading"
              role="status"
              aria-label={loadingMessage}
            >
              <span className="wiki-thinking-label">{loadingMessage}</span>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function imageFilename(source?: string): string | undefined {
  if (!source?.startsWith("./images/")) {
    return undefined;
  }

  return source.slice("./images/".length);
}
