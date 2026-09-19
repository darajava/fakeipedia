import { lstat, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const imageExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg",
  ".bmp", ".tif", ".tiff", ".ico", ".heic", ".heif",
]);

export async function planWikiReset(directory: string) {
  const root = path.resolve(directory);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("wiki-files must be a real directory, not a symbolic link.");
  }

  const files: string[] = [];
  const stubs: string[] = [];

  async function visit(currentDirectory: string, insideImages: boolean) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const filePath = path.join(currentDirectory, entry.name);
      const filename = entry.name.toLowerCase();
      const isImagesDirectory = filename === "images";
      if (entry.isDirectory()) {
        await visit(filePath, insideImages || isImagesDirectory);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (filename.startsWith("stub-") && filename.endsWith(".md")) {
          stubs.push(filePath);
        } else if (
          filename.endsWith(".md") || imageExtensions.has(path.extname(filename)) ||
          insideImages || (entry.isSymbolicLink() && isImagesDirectory)
        ) {
          // Moving/removing a symlink affects only the link, never its target.
          files.push(filePath);
        }
      }
    }
  }

  await visit(root, false);
  return { files: files.sort(), stubs: stubs.sort() };
}

export async function resetWiki(directory: string, resetDatabase: () => Promise<void>) {
  const plan = await planWikiReset(directory);
  if (plan.files.length === 0) {
    await resetDatabase();
    return plan;
  }

  const stagingDirectory = await mkdtemp(path.join(path.dirname(path.resolve(directory)), ".wiki-reset-"));
  const staged: Array<{ original: string; temporary: string }> = [];

  try {
    for (const [index, original] of plan.files.entries()) {
      const temporary = path.join(stagingDirectory, String(index));
      await rename(original, temporary);
      staged.push({ original, temporary });
    }
    await resetDatabase();
  } catch (error) {
    // Restore generated content if staging or the database reset fails.
    for (const { original, temporary } of staged.reverse()) {
      await rename(temporary, original);
    }
    await rm(stagingDirectory, { recursive: true });
    throw error;
  }

  await rm(stagingDirectory, { recursive: true });
  return plan;
}
