import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { planWikiReset, resetWiki } from "./reset-wiki";

async function fixture(run: (root: string, directory: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "fakeipedia-reset-test-"));
  const directory = path.join(root, "wiki-files");
  try {
    await mkdir(path.join(directory, "zorg", "images"), { recursive: true });
    await mkdir(path.join(directory, "moon", "nested"), { recursive: true });
    const files = {
      "zorg/stub-zorg.md": "# Zorg\n\n[[Zorg]]",
      "moon/nested/stub-moon.md": "# Moon\n\n[[Moon]]",
      "zorg/zorg.md": "# Generated Zorg",
      "moon/nested/history.MD": "# Generated history",
      "zorg/images/zorg.png": "image bytes",
      "moon/moon.webp": "image outside the images directory",
      "zorg/notes.txt": "Keep these notes",
    };
    for (const [filename, contents] of Object.entries(files)) {
      await writeFile(path.join(directory, filename), contents);
    }
    await run(root, directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("plans a reset without changing files", async () => {
  await fixture(async (_root, directory) => {
    const plan = await planWikiReset(directory);
    assert.equal(plan.files.length, 4);
    assert.equal(plan.stubs.length, 2);
    for (const file of [...plan.files, ...plan.stubs]) assert.ok((await readFile(file)).length);
  });
});

test("removes generated articles and images while preserving stub bytes, folders and unrelated files", async () => {
  await fixture(async (root, directory) => {
    let databaseResets = 0;
    const result = await resetWiki(directory, async () => { databaseResets++; });
    assert.equal(databaseResets, 1);
    for (const file of result.files) await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal(await readFile(path.join(directory, "zorg", "stub-zorg.md"), "utf8"), "# Zorg\n\n[[Zorg]]");
    assert.equal(await readFile(path.join(directory, "moon", "nested", "stub-moon.md"), "utf8"), "# Moon\n\n[[Moon]]");
    assert.equal(await readFile(path.join(directory, "zorg", "notes.txt"), "utf8"), "Keep these notes");
    assert.deepEqual(await readdir(path.join(directory, "zorg", "images")), []);
    assert.deepEqual(await readdir(root), ["wiki-files"]);
  });
});

test("restores all generated files if clearing the database fails", async () => {
  await fixture(async (root, directory) => {
    const plan = await planWikiReset(directory);
    const originals = await Promise.all(plan.files.map((file) => readFile(file)));
    await assert.rejects(resetWiki(directory, async () => {
      throw new Error("Database reset failed");
    }), /Database reset failed/);
    for (const [index, file] of plan.files.entries()) {
      assert.deepEqual(await readFile(file), originals[index]);
    }
    assert.deepEqual(await readdir(root), ["wiki-files"]);
  });
});

test("preserves stubs even inside an image directory", async () => {
  await fixture(async (_root, directory) => {
    const stub = path.join(directory, "zorg", "images", "stub-example.md");
    await writeFile(stub, "Preserve this stub");
    await writeFile(path.join(directory, "zorg", "images", "generation-metadata.json"), "{}");
    await resetWiki(directory, async () => {});
    assert.deepEqual(await readdir(path.dirname(stub)), ["stub-example.md"]);
    assert.equal(await readFile(stub, "utf8"), "Preserve this stub");
  });
});

test("does not follow symlinked files or image directories outside wiki-files", async () => {
  await fixture(async (root, directory) => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "keep.md"), "External article");
    await writeFile(path.join(outside, "keep.png"), "External image");
    await symlink(outside, path.join(directory, "moon", "images"));
    await symlink(path.join(outside, "keep.md"), path.join(directory, "zorg", "linked.md"));
    await resetWiki(directory, async () => {});
    assert.equal(await readFile(path.join(outside, "keep.md"), "utf8"), "External article");
    assert.equal(await readFile(path.join(outside, "keep.png"), "utf8"), "External image");
  });
});

test("resets an already empty wiki without leaving temporary directories", async () => {
  await fixture(async (root, directory) => {
    await resetWiki(directory, async () => {});
    let databaseResets = 0;
    const result = await resetWiki(directory, async () => { databaseResets++; });
    assert.equal(databaseResets, 1);
    assert.equal(result.files.length, 0);
    assert.equal(result.stubs.length, 2);
    assert.deepEqual(await readdir(root), ["wiki-files"]);
  });
});

test("rejects a missing or symlinked wiki root before clearing the database", async () => {
  await fixture(async (root, directory) => {
    const alias = path.join(root, "alias");
    await symlink(directory, alias);
    for (const target of [alias, path.join(root, "missing")]) {
      await assert.rejects(resetWiki(target, async () => {
        assert.fail("Must not reset database without a valid wiki directory");
      }));
    }
    assert.equal(await readFile(path.join(directory, "zorg", "zorg.md"), "utf8"), "# Generated Zorg");
  });
});
