"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteArticle } from "./delete-article-action";

export function DeleteArticleButton({ wiki, slug }: { wiki: string; slug: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function handleDelete() {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await deleteArticle(wiki, slug);
        if (result.error) {
          setError(result.error);
          return;
        }

        if (window.history.length > 1) {
          router.back();
        } else {
          router.replace("/");
        }
      } catch {
        setError("Could not delete the article. Please try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="wiki-delete-button"
        disabled={isPending}
        onClick={handleDelete}
      >
        {isPending ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="wiki-delete-error" role="alert">{error}</span>}
    </>
  );
}
