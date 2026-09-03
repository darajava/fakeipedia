import "dotenv/config";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { articles } from "../db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing from .env");
}

const wikiDirectory = path.join(process.cwd(), "wiki-files");
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle({ client: pool });

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function firstHeading(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  return match?.[1].replace(/\s+#+\s*$/, "").trim();
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

async function importFile(filePath: string): Promise<void> {
  const source = await readFile(filePath, "utf8");
  const { data, content } = matter(source);
  const filename = path.basename(filePath, path.extname(filePath));

  const slug = slugify(String(data.slug ?? filename));
  const title = String(
    data.title ?? firstHeading(content) ?? titleFromSlug(slug),
  ).trim();
  const markdown = content.trim() + "\n";
  const isPremium = booleanValue(data.is_premium ?? data.isPremium);

  if (!slug) {
    throw new Error(`Could not create a slug for ${filePath}`);
  }

  if (!title) {
    throw new Error(`Could not find a title for ${filePath}`);
  }

  if (!content.trim()) {
    throw new Error(`Markdown file is empty: ${filePath}`);
  }

  await db
    .insert(articles)
    .values({
      slug,
      title,
      content: markdown,
      isPremium,
    })
    .onConflictDoUpdate({
      target: articles.slug,
      set: {
        title,
        content: markdown,
        isPremium,
        updatedAt: new Date(),
      },
    });

  console.log(`Imported ${path.relative(wikiDirectory, filePath)} -> ${slug}`);
}

async function main(): Promise<void> {
  const files = await findMarkdownFiles(wikiDirectory);

  if (files.length === 0) {
    throw new Error(`No Markdown files found in ${wikiDirectory}`);
  }

  for (const file of files) {
    await importFile(file);
  }

  console.log(`Finished importing ${files.length} article(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
