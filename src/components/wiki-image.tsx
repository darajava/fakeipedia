"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ArticleImageState } from "@/lib/article-image-status";

type WikiImageProps = {
  src: string;
  alt: string;
  caption?: string;
  captionContent?: ReactNode;
  priority?: boolean;
  unavailable?: boolean;
  generating?: boolean;
  retryImage?: { wiki: string; slug: string; filename: string; prompt: string };
};

export function WikiImage({ src, alt, caption, captionContent, priority = false, unavailable = false, generating = false, retryImage }: WikiImageProps) {
  const [open, setOpen] = useState(false);
  const [failedSource, setFailedSource] = useState<string>();
  const [replacement, setReplacement] = useState<{ original: string; url: string }>();
  const [retrying, setRetrying] = useState(false);
  const [awaitingGeneration, setAwaitingGeneration] = useState(generating);
  const [retryError, setRetryError] = useState<string>();
  const [editedPrompt, setEditedPrompt] = useState<{ source: string; value: string }>();
  const retryInFlight = useRef(false);
  const imageSource = replacement?.original === src ? replacement.url : src;
  const captionId = useId();
  const promptId = useId();
  const prompt = editedPrompt?.source === src ? editedPrompt.value : retryImage?.prompt ?? alt;
  const renderedCaption = captionContent ?? (caption || alt);
  const imageWiki = retryImage?.wiki;
  const imageSlug = retryImage?.slug;
  const imageFilename = retryImage?.filename;

  useEffect(() => {
    if (!imageWiki || !imageSlug || !imageFilename || replacement?.original === src || (!generating && failedSource !== src)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const response = await fetch(`/api/articles/images/status?wiki=${encodeURIComponent(imageWiki!)}&slug=${encodeURIComponent(imageSlug!)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Image status unavailable");
        const result = await response.json() as { images: Record<string, ArticleImageState> };
        if (cancelled) return;
        const image = result.images[imageFilename!];
        if (image?.state === "pending") {
          setAwaitingGeneration(true);
          timer = setTimeout(check, 2000);
        } else {
          setAwaitingGeneration(false);
          if (image?.state === "ready") {
            setReplacement({ original: src, url: `${image.url}?v=${Date.now()}` });
            setFailedSource(undefined);
          } else setFailedSource(src);
        }
      } catch {
        if (!cancelled) timer = setTimeout(check, 3000);
      }
    }
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [src, generating, failedSource, replacement?.original, imageWiki, imageSlug, imageFilename]);

  async function retry() {
    if (retryInFlight.current || (retryImage && !prompt.trim())) return;
    retryInFlight.current = true;
    setRetrying(true);
    setRetryError(undefined);
    try {
      let url: string;
      if (retryImage) {
        const response = await fetch("/api/articles/images/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...retryImage, prompt: prompt.trim() }),
        });
        const result = await response.json();
        if (!response.ok || typeof result.url !== "string" || !result.url) {
          throw new Error(result.error || "Could not generate this image. Please try again.");
        }
        url = result.url;
      } else {
        const refreshed = new URL(src, window.location.href);
        refreshed.searchParams.set("v", Date.now().toString());
        url = refreshed.href;
      }
      setReplacement({ original: src, url });
      setFailedSource(undefined);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Image retry failed. Please try again.");
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;

      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (awaitingGeneration && imageSource === src) {
    return <span className="wiki-image-frame wiki-image-generating">
      <span className="wiki-image-loading-area" role="status"><span className="wiki-loading-spinner" aria-hidden="true" /><span>Generating image…</span></span>
      <span className="wiki-image-caption"><span>{renderedCaption}</span></span>
    </span>;
  }

  if (retrying || (unavailable && imageSource === src) || failedSource === imageSource) {
    return (
      <span className="wiki-image-frame">
        <span className="wiki-image-unavailable" aria-busy={retrying}>
          {retrying && <span className="wiki-loading-spinner" aria-hidden="true" />}
          <span role="status">{retrying ? "Retrying image…" : retryError || "Image unavailable"}</span>
          {retryImage && <span className="wiki-image-prompt">
            <label htmlFor={promptId}>Image prompt</label>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(event) => setEditedPrompt({ source: src, value: event.target.value })}
              rows={5}
              maxLength={32_000}
              disabled={retrying}
            />
          </span>}
          <button type="button" className="wiki-image-retry" onClick={retry} disabled={retrying || Boolean(retryImage && !prompt.trim())}>
            {retrying ? "Retrying…" : "Retry image"}
          </button>
        </span>
        <span className="wiki-image-caption"><span>{renderedCaption}</span></span>
      </span>
    );
  }

  return (
    <span className="wiki-image-frame">
      <button
        type="button"
        className="wiki-image-thumbnail"
        onClick={() => setOpen(true)}
        aria-label={`Open image: ${alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSource}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          onError={() => {
            setFailedSource(imageSource);
            setOpen(false);
          }}
        />

      </button>

      <span className="wiki-image-caption">
        <span>{renderedCaption}</span>
        <button type="button" className="wiki-image-expand-icon" onClick={() => setOpen(true)} aria-label="Expand image">
          <span aria-hidden="true">⛶</span>
        </button>
      </span>

      {open && (
        <span
          className="wiki-photobox"
          role="dialog"
          aria-modal="true"
          aria-labelledby={caption ? captionId : undefined}
          aria-label={caption ? undefined : alt}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="wiki-photobox-close"
            onClick={() => setOpen(false)}
            aria-label="Close image"
          >
            ×
          </button>

          <span
            className="wiki-photobox-content"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSource} alt={alt} />

            {caption && (
              <span id={captionId} className="wiki-photobox-caption">
                {renderedCaption}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
