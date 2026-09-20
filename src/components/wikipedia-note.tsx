import { wikipediaArticleUrl } from "@/lib/wikipedia";

export async function WikipediaNote({ title }: { title: string }) {
  const url = await wikipediaArticleUrl(title);
  if (!url) return null;

  return (
    <p className="wiki-hatnote">
      For the real Wikipedia article, see{" "}
      <a href={url} target="_blank" rel="noopener noreferrer">
        {title}
      </a>
      .
    </p>
  );
}
