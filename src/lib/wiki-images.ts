import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validSlug } from "./wiki";

const contentTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export async function readWikiImage(
  wikiDirectory: string,
  wiki: string,
  image: string[],
) {
  if (!validSlug(wiki) || image.length === 0 || image.some((part) =>
    !part || part === "." || part === ".." ||
    part.includes("/") || part.includes("\\") || part.includes("\0")
  )) {
    return undefined;
  }

  const contentType = contentTypes[path.extname(image.at(-1)!).toLowerCase()];
  if (!contentType) return undefined;

  try {
    const root = await realpath(wikiDirectory);
    const imageDirectory = path.join(root, wiki, "images");
    const filePath = await realpath(path.join(imageDirectory, ...image));

    // Symlinks must not expose files outside this wiki's image directory.
    if (!filePath.startsWith(imageDirectory + path.sep)) return undefined;

    return { contentType, data: await readFile(filePath) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return undefined;
    }
    throw error;
  }
}
