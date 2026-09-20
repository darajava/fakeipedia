import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWikiArticles, readWikiDefinition } from "./wiki-files";

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
    "rome/eras/history.md": "---\ntitle: Roman history\nslug: history\n---\n\nThe empire.",
    "zorg/images/map.png": "image placeholder",
  }, async (directory) => {
    const articles = await readWikiArticles(directory);
    assert.equal(articles.length, 2);
    assert.deepEqual(articles.map(({ wiki, slug, title }) => ({ wiki, slug, title })), [
      { wiki: "rome", slug: "history", title: "Roman history" },
      { wiki: "zorg", slug: "history", title: "History of Zorg" },
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

test("homepage definitions preserve stub titles and subtitles and use the final target link", async () => {
  await fixture({
    "asi/stub-asi.md": "---\ntitle: ASI\nsubtitle: Humanity in 2048.\nslug: stub-asi\n---\n[[Earth]] [[ASI]]",
    "conspiracy/stub-conspiracy.md": "---\ntitle: Conspiracy Theory\nsubtitle: Every conspiracy is true.\n---\n[[Conspiracy Theory]]",
    "post-privacy/stub-post-privacy.md": "---\ntitle: The Post Privacy Era\nsubtitle: No more secrets.\n---\n[[Privacy]] [[The Great Leak of 2027|Enter]]",
    "asi/asi.md": "---\ntitle: Wrong homepage title\n---\n# Generated article",
  }, async (directory) => {
    assert.deepEqual(await readWikiDefinition(directory, "asi"), {
      title: "ASI", subtitle: "Humanity in 2048.", mainPageSlug: "asi",
    });
    assert.deepEqual(await readWikiDefinition(directory, "conspiracy"), {
      title: "Conspiracy Theory", subtitle: "Every conspiracy is true.", mainPageSlug: "conspiracy-theory",
    });
    assert.deepEqual(await readWikiDefinition(directory, "post-privacy"), {
      title: "The Post Privacy Era", subtitle: "No more secrets.", mainPageSlug: "the-great-leak-of-2027",
    });
    await writeFile(path.join(directory, "asi/stub-asi.md"), "---\ntitle: ASI\nsubtitle: Updated subtitle.\n---\n[[ASI]]");
    assert.equal((await readWikiDefinition(directory, "asi")).subtitle, "Updated subtitle.");
  });
});

test("homepage definitions support older wikis and reject ambiguous or invalid stubs", async () => {
  await fixture({
    "old-world/history.md": "# History",
    "missing-target/stub-world.md": "# No target",
    "ambiguous/stub-one.md": "[[One]]",
    "ambiguous/stub-two.md": "[[Two]]",
  }, async (directory) => {
    assert.deepEqual(await readWikiDefinition(directory, "old-world"), {
      title: "Old World", subtitle: "", mainPageSlug: undefined,
    });
    assert.equal((await readWikiDefinition(directory, "db-only")).title, "Db Only");
    await assert.rejects(readWikiDefinition(directory, "../outside"), /Invalid wiki slug/);
    await assert.rejects(readWikiDefinition(directory, "missing-target"), /No valid target link/);
    await assert.rejects(readWikiDefinition(directory, "ambiguous"), /found 2/);
  });
});
