import path from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import OpenAI from "openai";
import { extractArticleImages } from "./article-draft";

const MAX_IMAGE_PROMPT_LENGTH = 32_000;

export type ArticleImageMessage =
  | { type: "images-start"; count: number }
  | { type: "image-start"; filename: string; index: number; count: number }
  | { type: "image-done"; filename: string; url: string }
  | { type: "image-error"; filename: string; message: string };

function truncate(text: string, length: number): string {
  // Avoid splitting an emoji or other surrogate pair at the cutoff.
  return text.slice(0, Math.max(0, length)).replace(/[\uD800-\uDBFF]$/, "");
}

export function buildArticleImagePrompt(title: string, markdown: string, description: string): string {
  const instructions = `Create an encyclopedic illustration for a fictional encyclopedia article.

Make it photorealistic.

ARTICLE TITLE:

${truncate(title, 160)}

Requirements:
- Landscape composition.
- Suitable for an encyclopedia article.
- Natural, believable visual style appropriate to the subject.
- No writing, captions, labels, logos or watermarks.
- Do not create an infographic.
- Do not include visible text anywhere in the image.
- Remain consistent with the article context.

IMAGE REQUIRED:

`;
  const contextHeading = "\n\nARTICLE CONTEXT (excerpt if needed):\n\n<article>\n";
  const contextEnd = "\n</article>";
  const available = MAX_IMAGE_PROMPT_LENGTH - instructions.length - contextHeading.length - contextEnd.length;
  // Keep the image-specific request and requirements; trim article context first.
  const imageDescription = truncate(description, available);
  const context = truncate(markdown, available - imageDescription.length);
  return instructions + imageDescription + contextHeading + context + contextEnd;
}

export async function generateArticleImages(
  { wiki, markdown, slug, title }: { wiki: string; markdown: string; slug: string; title: string },
  send: (message: ArticleImageMessage) => void,
  { client, wikiDirectory = path.join(process.cwd(), "wiki-files") }: { client?: OpenAI; wikiDirectory?: string } = {},
) {
  const images = extractArticleImages(markdown, slug);
  if (images.length === 0) return;

  const archiveDirectory = path.join(wikiDirectory, wiki, "images");
  send({ type: "images-start", count: images.length });

  // Wait for every image, isolating failures so other images can finish.
  await Promise.all(images.map(async (image, index) => {
    send({ type: "image-start", filename: image.filename, index: index + 1, count: images.length });

    try {
      await mkdir(archiveDirectory, { recursive: true });
      const openai = client ?? new OpenAI();
      const result = await openai.images.generate({
        model: "gpt-image-2.5-flare",
        prompt: buildArticleImagePrompt(title, markdown, image.description),
        n: 1,
        size: "1536x864",
        quality: "high",
        output_format: "png",
      });

      const generatedImage = result.data?.[0]?.b64_json;
      if (!generatedImage) throw new Error(`OpenAI returned no image data for ${image.filename}.`);

      const temporaryPath = path.join(archiveDirectory, `.${slug}-${crypto.randomUUID()}.tmp`);
      await writeFile(temporaryPath, Buffer.from(generatedImage, "base64"));
      await rename(temporaryPath, path.join(archiveDirectory, image.filename));
    } catch (error) {
      console.error(`Image generation failed for ${wiki}/${image.filename}:`, error);
      send({ type: "image-error", filename: image.filename, message: "Could not generate this image." });
      return;
    }

    send({
      type: "image-done",
      filename: image.filename,
      url: `/wiki-images/${encodeURIComponent(wiki)}/${encodeURIComponent(image.filename)}`,
    });
  }));
}
