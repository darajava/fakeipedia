import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWikiArticles } from "./wiki-files";

async function fixture(files: Record<string, string>, run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-wikis-"));
  try {
    for (const [filename, content] of Object.entries(files)) {
      const target = path.join(directory, filename);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("imports the same article slug independently in two worlds, including nested files", async () => {
  await fixture({
    "zorg/history.md": "# History of Zorg\n\nThe canals.",
    "rome/eras/history.md": "---\ntitle: Roman history\nslug: history\nis_premium: true\n---\n\nThe empire.",
    "zorg/images/map.png": "image placeholder",
  }, async (directory) => {
    const articles = await readWikiArticles(directory);
    assert.equal(articles.length, 2);
    assert.deepEqual(articles.map(({ wiki, slug, title, isPremium }) => ({ wiki, slug, title, isPremium })), [
      { wiki: "rome", slug: "history", title: "Roman history", isPremium: true },
      { wiki: "zorg", slug: "history", title: "History of Zorg", isPremium: false },
    ]);
  });
});

test("rejects duplicate slugs within one wiki before importing", async () => {
  await fixture({
    "zorg/history.md": "# History\n\nOne.",
    "zorg/old/history.md": "# History\n\nTwo.",
  }, async (directory) => {
    await assert.rejects(readWikiArticles(directory), /Duplicate article: zorg\/history/);
  });
});

test("requires articles to live under a wiki directory", async () => {
  await fixture({ "zorg.md": "# Zorg\n\nA planet." }, async (directory) => {
    await assert.rejects(readWikiArticles(directory), /inside wiki-files/);
  });
});
