import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { slugify, titleFromSlug, validSlug, validWikiSlug } from "./wiki";
import { worldOverviewSlug } from "./world-overview";

// Read only the wiki's stub, so homepage metadata stays current without an import.
export async function readWikiDefinition(directory: string, wiki: string) {
  if (!validWikiSlug(wiki)) throw new Error("Invalid wiki slug.");
  const fallback = { title: titleFromSlug(wiki), subtitle: "", mainPageSlug: undefined as string | undefined };
  const wikiDirectory = path.join(directory, wiki);
  let entries;
  try {
    entries = await readdir(wikiDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  const stubs = entries.filter((entry) => entry.isFile() && /^stub-.*\.md$/i.test(entry.name));
  if (stubs.length === 0) return fallback;
  if (stubs.length > 1) throw new Error(`Expected one homepage stub in wiki-files/${wiki}; found ${stubs.length}.`);

  const { data, content } = matter(await readFile(path.join(wikiDirectory, stubs[0].name), "utf8"));
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1].replace(/\s+#+\s*$/, "").trim();
  const title = String(data.title ?? heading ?? fallback.title).trim();
  const slug = slugify(String(data.slug ?? path.basename(stubs[0].name, path.extname(stubs[0].name))));
  const mainPageSlug = worldOverviewSlug({ slug, title, content }, wiki);
  if (!mainPageSlug) throw new Error(`No valid target link in wiki-files/${wiki}/${stubs[0].name}.`);
  return { title, subtitle: String(data.subtitle ?? "").trim(), mainPageSlug };
}

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
    if (parts.length < 2 || !validWikiSlug(wiki)) {
      throw new Error(`Place ${relativePath} inside wiki-files/<wiki-slug>/ using a lowercase, non-reserved wiki slug.`);
    }

    const { data, content } = matter(await readFile(filePath, "utf8"));
    const filename = path.basename(filePath, path.extname(filePath));
    const slug = slugify(String(data.slug ?? filename));
    const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1].replace(/\s+#+\s*$/, "").trim();
    const title = String(data.title ?? heading ?? titleFromSlug(slug)).trim();

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
    };
  }));
}
