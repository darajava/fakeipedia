"use client";

import { useEffect, useId, useState } from "react";

type WikiImageProps = {
  src: string;
  alt: string;
  caption?: string;
};

export function WikiImage({ src, alt, caption }: WikiImageProps) {
  const [open, setOpen] = useState(false);
  const captionId = useId();

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

  return (
    <span className="wiki-image-frame">
      <button
        type="button"
        className="wiki-image-thumbnail"
        onClick={() => setOpen(true)}
        aria-label={`Open image: ${caption || alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" />

        <span className="wiki-image-caption">
          <span>{caption || alt}</span>

          <span className="wiki-image-expand-icon" aria-hidden="true">
            ⛶
          </span>
        </span>
      </button>

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
            <img src={src} alt={alt} />

            {caption && (
              <span id={captionId} className="wiki-photobox-caption">
                {caption}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
