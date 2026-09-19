import { generateArticleText } from "./article-text";

export type ArticleImage = { filename: string; description: string };
type DraftOptions = { prompt: string; slug: string; isWorldOverview: boolean };
type DraftMessage = { type: "delta"; delta: string };

export function extractArticleImages(markdown: string, slug: string): ArticleImage[] {
  const images = new Map<string, ArticleImage>();
  const pattern = /!\[([^\]]+)\]\(\.\/images\/([a-z0-9_-]+\.png)\s+"([^"]+)"\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const description = match[1].trim();
    const filename = match[2];
    if (filename.startsWith(`${slug}_`) && description && match[3].trim()) {
      images.set(filename, { filename, description });
    }
  }
  return [...images.values()];
}

export function articleDraftIssues(markdown: string, slug: string, isWorldOverview: boolean): string[] {
  const issues: string[] = [];
  const imageSyntax = /!\[[^\]]*\]\([^\n]*\)/g;
  const references = [...markdown.matchAll(imageSyntax)];
  const images = extractArticleImages(markdown, slug);
  if (isWorldOverview ? images.length !== 5 : images.length < 1 || images.length > 5) {
    issues.push(`Include ${isWorldOverview ? "exactly 5" : "between 1 and 5"} distinct images, including the main subject image.`);
  }
  if (references.length !== images.length) {
    issues.push(`Every image must use a unique ./images/${slug}_name.png path, detailed alt text and a quoted caption in the required Markdown syntax.`);
  }

  if (isWorldOverview) {
    // Image-generation descriptions are not article prose.
    const prose = markdown.replace(imageSyntax, "").replace(/^#{1,6} .+$/gm, "");
    const words = prose.trim().split(/\s+/).filter(Boolean).length;
    const sections = [...markdown.matchAll(/^##\s+(.+)$/gm)]
      .filter((match) => !/^see also\s*$/i.test(match[1]));
    if (words < 1600) issues.push(`Expand the article from approximately ${words} words to approximately 2,000 words of developed prose.`);
    if (sections.length < 8) issues.push("Provide 8–10 developed main sections covering a broad range of the world's geography, history, society and everyday life.");
  }
  return issues;
}

/** Generate and validate one draft before image generation or persistence. */
export async function generateArticleDraft(
  { prompt, slug, isWorldOverview }: DraftOptions,
  send: (message: DraftMessage) => void,
  generate: (prompt: string) => AsyncIterable<string> = generateArticleText,
): Promise<string> {
  let markdown = "";
  for await (const delta of generate(prompt)) {
    markdown += delta;
    send({ type: "delta", delta });
  }
  markdown = markdown.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!markdown) throw new Error("Gemini returned an empty article.");
  const issues = articleDraftIssues(markdown, slug, isWorldOverview);
  if (issues.length) throw new Error(`The article does not meet its requirements: ${issues.join(" ")}`);
  return markdown;
}
