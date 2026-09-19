import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { slugify, titleFromSlug, validSlug } from "./wiki";

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

export async function findWikiArticleFiles(directory: string, wiki: string, slug: string) {
  if (!validSlug(wiki) || !validSlug(slug)) {
    throw new Error("Invalid wiki or article slug.");
  }

  let wikiDirectory: string;
  try {
    const root = await realpath(directory);
    wikiDirectory = path.join(root, wiki);
    if (await realpath(wikiDirectory) !== wikiDirectory) {
      throw new Error("Cannot delete articles through a symbolic wiki directory.");
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return [];
    }
    throw error;
  }

  const matches: string[] = [];
  for (const filePath of await findMarkdownFiles(wikiDirectory)) {
    const { data } = matter(await readFile(filePath, "utf8"));
    const filename = path.basename(filePath, path.extname(filePath));
    if (slugify(String(data.slug ?? filename)) === slug) matches.push(filePath);
  }
  return matches;
}

export async function readWikiArticles(directory: string) {
  const files = await findMarkdownFiles(directory);
  const seen = new Set<string>();

  return Promise.all(files.map(async (filePath) => {
    const relativePath = path.relative(directory, filePath);
    const parts = relativePath.split(path.sep);
    const wiki = parts[0];
    if (parts.length < 2 || !validSlug(wiki)) {
      throw new Error(`Place ${relativePath} inside wiki-files/<wiki-slug>/ using a lowercase wiki slug.`);
    }

    const { data, content } = matter(await readFile(filePath, "utf8"));
    const filename = path.basename(filePath, path.extname(filePath));
    const slug = slugify(String(data.slug ?? filename));
    const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1].replace(/\s+#+\s*$/, "").trim();
    const title = String(data.title ?? heading ?? titleFromSlug(slug)).trim();
    const premium = data.is_premium ?? data.isPremium;

    if (!slug || !title || !content.trim()) {
      throw new Error(`Article needs a slug, title and content: ${relativePath}`);
    }
    const key = `${wiki}/${slug}`;
    if (seen.has(key)) throw new Error(`Duplicate article: ${key}`);
    seen.add(key);

    return {
      wiki,
      slug,
      title,
      content: content.trim() + "\n",
      isPremium: premium === true || premium === "true",
    };
  }));
}
