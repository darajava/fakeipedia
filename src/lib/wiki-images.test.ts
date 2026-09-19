import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readWikiImage } from "./wiki-images";

test("serves each wiki's original image without a public copy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-images-"));
  try {
    for (const wiki of ["zorg", "rome"]) {
      await mkdir(path.join(directory, wiki, "images", "maps"), { recursive: true });
      await writeFile(path.join(directory, wiki, "images", "maps", "world.png"), wiki);
    }

    const zorg = await readWikiImage(directory, "zorg", ["maps", "world.png"]);
    const rome = await readWikiImage(directory, "rome", ["maps", "world.png"]);
    assert.equal(zorg?.contentType, "image/png");
    assert.equal(zorg?.data.toString(), "zorg");
    assert.equal(rome?.data.toString(), "rome");

    // New and updated images are available directly, without an import/copy.
    await writeFile(path.join(directory, "zorg", "images", "maps", "world.png"), "updated");
    assert.equal((await readWikiImage(directory, "zorg", ["maps", "world.png"]))?.data.toString(), "updated");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects traversal, symlinks into other wikis, non-images and missing files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-image-boundary-"));
  try {
    await mkdir(path.join(directory, "zorg", "images"), { recursive: true });
    await mkdir(path.join(directory, "rome", "images"), { recursive: true });
    await writeFile(path.join(directory, "rome", "images", "world.png"), "rome");
    await writeFile(path.join(directory, "zorg", "images", "article.md"), "private text");
    await symlink(path.join(directory, "rome", "images", "world.png"), path.join(directory, "zorg", "images", "escape.png"));

    const invalid: [string, string[]][] = [
      ["../rome", ["world.png"]],
      ["zorg", ["..", "..", "rome", "images", "world.png"]],
      ["zorg", ["../../rome/images/world.png"]],
      ["zorg", ["..\\..\\rome\\images\\world.png"]],
      ["zorg", ["world\0.png"]],
      ["zorg", ["escape.png"]],
      ["zorg", ["article.md"]],
      ["zorg", ["missing.png"]],
      ["missing", ["world.png"]],
      ["zorg", []],
    ];
    for (const [wiki, image] of invalid) {
      assert.equal(await readWikiImage(directory, wiki, image), undefined);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
