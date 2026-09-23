"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { articleLink, articlePath, prepareWikiLinks } from "@/lib/wiki";
import { WikiImage } from "@/components/wiki-image";
import { WikiCaption } from "@/components/wiki-caption";
import { WikiTable } from "@/components/wiki-table";
import { rehypeCodeLinks } from "@/lib/rehype-code-links";
import { remarkSubjectInfobox } from "@/lib/remark-subject-infobox";
import { applyLiveMessage, type GenerationLiveMessage, type LivePreview } from "@/lib/generation-live";
import { emptyGenerationProgress } from "@/lib/generation-progress";

const loadingMessages = [
  "Generating article",
  "Organising sections",
  "Considering history",
];

export type GenerateArticleProps = {
  wiki: string; slug: string; title: string; intentId: string; token: string;
  existingArticleSlugs: string[]; onRetry?: () => void;
};

export function GenerateArticle({ wiki, slug, title, intentId, token, existingArticleSlugs, onRetry }: GenerateArticleProps) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState("");
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
      table: WikiTable,
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
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let preview: LivePreview = { generationId: null, progress: emptyGenerationProgress() };
    async function connect() {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetch("/api/articles/progress", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token }), signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error ?? "Could not connect to live generation.");
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim() || abort.signal.aborted) continue;
            const message = JSON.parse(line) as GenerationLiveMessage;
            preview = applyLiveMessage(preview, message);
            setMarkdown(preview.progress.markdown);
            setReadyImages(preview.progress.readyImages);
            setFailedImages(preview.progress.failedImages);
            setError(undefined);
            if (message.type === "snapshot") {
              if (message.previewComplete || message.status === "superseded") {
                router.replace(articlePath(wiki, slug)); router.refresh(); return;
              }
              if (message.status === "failed") {
                setError(`We couldn’t finish this article. ${message.funding === "credit" ? "Your credit has been returned. " : ""}Your answer is saved.`);
                return;
              }
              setStatus(message.status === "queued"
                ? message.attempts ? "Generation was interrupted. Retrying automatically…" : "Your article is queued…"
                : "");
            }
          }
          if (done) break;
        }
        if (!abort.signal.aborted) timer = setTimeout(connect, 500);
      } catch (failure) {
        if (abort.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "Connection interrupted. Reconnecting…");
        timer = setTimeout(connect, 3000);
      } finally { await reader?.cancel().catch(() => {}); }
    }
    void connect();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [router, wiki, slug, intentId, token]);

  return (
    <section className="wiki-generator" aria-busy={!error}>
      {error && (
        <div className="wiki-generation-error">
          <p>{error}</p>

          <button type="button" onClick={onRetry ?? (() => window.location.reload())}>
            Try again
          </button>
        </div>
      )}
      {status && !error && <p className="wiki-generation-status" role="status">{status}</p>}
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
    </section>
  );
}

function imageFilename(source?: string): string | undefined {
  if (!source?.startsWith("./images/")) {
    return undefined;
  }

  return source.slice("./images/".length);
}
