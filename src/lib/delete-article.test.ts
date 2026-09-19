import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deleteWikiArticle } from "./delete-article";

async function fixture(run: (directory: string) => Promise<void>) {
  const previousEnvironment = process.env.NODE_ENV;
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-delete-"));
  Object.assign(process.env, { NODE_ENV: "development" });
  try {
    await mkdir(path.join(directory, "zorg"));
    await run(directory);
  } finally {
    if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousEnvironment });
    await rm(directory, { recursive: true, force: true });
  }
}

test("deletes the matching article and record while preserving other worlds, articles and images", async () => {
  await fixture(async (directory) => {
    await mkdir(path.join(directory, "zorg", "images"));
    await mkdir(path.join(directory, "moon"));
    await writeFile(path.join(directory, "zorg", "history.md"), "# History");
    await writeFile(path.join(directory, "zorg", "stub-zorg.md"), "# Zorg\n\n[[Zorg]]");
    await writeFile(path.join(directory, "moon", "history.md"), "# Moon history");
    await writeFile(path.join(directory, "zorg", "images", "history.png"), "image");
    let recordExists = true;

    await deleteWikiArticle(directory, "zorg", "history", async () => {
      await assert.rejects(readFile(path.join(directory, "zorg", "history.md")), { code: "ENOENT" });
      recordExists = false;
    });

    assert.equal(recordExists, false);
    assert.deepEqual((await readdir(path.join(directory, "zorg"))).sort(), ["images", "stub-zorg.md"]);
    assert.equal(await readFile(path.join(directory, "moon", "history.md"), "utf8"), "# Moon history");
    assert.equal(await readFile(path.join(directory, "zorg", "images", "history.png"), "utf8"), "image");
  });
});

test("finds nested imported Markdown by its frontmatter slug rather than assuming its filename", async () => {
  await fixture(async (directory) => {
    await mkdir(path.join(directory, "zorg", "drafts"));
    await writeFile(path.join(directory, "zorg", "drafts", "original.md"), "---\nslug: history\n---\n# History");
    await writeFile(path.join(directory, "zorg", "history.md"), "---\nslug: another-article\n---\n# Another article");

    await deleteWikiArticle(directory, "zorg", "history", async () => {});

    assert.deepEqual(await readdir(path.join(directory, "zorg", "drafts")), []);
    assert.match(await readFile(path.join(directory, "zorg", "history.md"), "utf8"), /another-article/);
  });
});

test("restores all matching Markdown files when database deletion fails", async () => {
  await fixture(async (directory) => {
    const content = "---\nslug: history\n---\n# History\n\nOriginal content.";
    await writeFile(path.join(directory, "zorg", "history.md"), content);
    await writeFile(path.join(directory, "zorg", "copy.md"), content);

    await assert.rejects(deleteWikiArticle(directory, "zorg", "history", async () => {
      throw new Error("Database unavailable");
    }), /Database unavailable/);

    assert.deepEqual((await readdir(path.join(directory, "zorg"))).sort(), ["copy.md", "history.md"]);
    for (const file of ["copy.md", "history.md"]) {
      assert.equal(await readFile(path.join(directory, "zorg", file), "utf8"), content);
    }
  });
});

test("can remove stale database records when the Markdown file or wiki directory is already missing", async () => {
  await fixture(async (directory) => {
    let deletions = 0;
    for (const wiki of ["zorg", "missing"]) {
      await deleteWikiArticle(directory, wiki, "history", async () => { deletions++; });
    }
    assert.equal(deletions, 2);
  });
});

test("rejects deletion outside development before changing files or accessing the database", async () => {
  await fixture(async (directory) => {
    await writeFile(path.join(directory, "zorg", "history.md"), "Original");
    for (const environment of ["production", "test", undefined]) {
      if (environment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: environment });

      await assert.rejects(deleteWikiArticle(directory, "zorg", "history", async () => {
        assert.fail("Database deletion must not run");
      }), /only available in development/);
      assert.equal(await readFile(path.join(directory, "zorg", "history.md"), "utf8"), "Original");
    }
  });
});

test("rejects traversal and symbolic wiki directories before deleting records", async () => {
  await fixture(async (directory) => {
    await writeFile(path.join(directory, "zorg", "history.md"), "Original");
    await symlink(path.join(directory, "zorg"), path.join(directory, "alias"));
    for (const [wiki, slug] of [["../zorg", "history"], ["zorg", "../history"], ["alias", "history"]]) {
      await assert.rejects(deleteWikiArticle(directory, wiki, slug, async () => {
        assert.fail("Database deletion must not run");
      }));
    }
    assert.equal(await readFile(path.join(directory, "zorg", "history.md"), "utf8"), "Original");
  });
});
