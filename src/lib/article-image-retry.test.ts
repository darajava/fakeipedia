import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("image retry validates ownership, isolates failure and saves only the requested image", async (t) => {
  const oldEnvironment = { DATABASE_URL: process.env.DATABASE_URL, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
  process.env.OPENAI_API_KEY = "test-openai";
  const originalDirectory = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-image-retry-"));
  process.chdir(directory);
  t.after(async () => {
    process.chdir(originalDirectory);
    for (const [name, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const { db } = await import("../db");
  const { POST } = await import("../app/api/articles/images/retry/route");
  const article = {
    slug: "harbor", title: "Harbor",
    content: '# Harbor\n\n![A coral harbor](./images/harbor_failed.png "Harbor")\n\n![The market](./images/harbor_success.png "Market")',
  };
  let found = true;
  let reads = 0;
  t.mock.method(db, "select", () => {
    reads++;
    return { from: () => ({ where: () => ({ limit: async () => found ? [article] : [] }) }) };
  });
  t.mock.method(db, "insert", () => { throw new Error("Retry must not rewrite the article"); });
  t.mock.method(console, "error", () => {});
  let calls = 0;
  let fail = true;
  let expectedDescription = "A coral harbor";
  let started!: () => void;
  const generationStarted = new Promise<void>((resolve) => { started = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/images/generations");
    const body = JSON.parse(String(init?.body));
    assert.ok(body.prompt.includes(`IMAGE REQUIRED:\n\n${expectedDescription}`));
    assert.ok(body.prompt.includes(article.content));
    if (!fail) {
      started();
      await gate;
    }
    return Response.json(fail ? { data: [] } : { data: [{ b64_json: Buffer.from("retried image").toString("base64") }] });
  });
  const input = { wiki: "atlantis", slug: "harbor", filename: "harbor_failed.png" };
  const request = (body: unknown) => POST(new Request("http://localhost/api/articles/images/retry", {
    method: "POST", body: JSON.stringify(body),
  }));

  for (const body of [null, {}, { ...input, wiki: "../escape" }, { ...input, slug: "../escape" },
    ...[null, 123, "", "  ", "x".repeat(32_001)].map((prompt) => ({ ...input, prompt })),
  ]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal((await POST(new Request("http://localhost/api/articles/images/retry", { method: "POST", body: "{" }))).status, 400);
  assert.equal(reads, 0);
  found = false;
  assert.equal((await request(input)).status, 404);
  found = true;
  for (const filename of ["../escape.png", "other_image.png", "harbor_missing.png"]) {
    assert.equal((await request({ ...input, filename })).status, 400);
  }
  assert.equal(calls, 0);

  const imagesDirectory = path.join(directory, "wiki-files/atlantis/images");
  await mkdir(imagesDirectory, { recursive: true });
  await writeFile(path.join(imagesDirectory, "harbor_success.png"), "original image");
  assert.equal((await request({ ...input, filename: "harbor_success.png", prompt: "Replace the existing image" })).status, 409);
  assert.equal(calls, 0);
  const failed = await request(input);
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /try again/i);
  fail = false;
  expectedDescription = "A quiet coral harbor at sunrise, without people.";
  const pending = request({ ...input, prompt: `  ${expectedDescription}  ` });
  await generationStarted;
  assert.equal((await request(input)).status, 409);
  assert.equal(calls, 2);
  release();
  const success = await pending;
  assert.equal(success.status, 200);
  assert.match((await success.json()).url, /^\/wiki-images\/atlantis\/harbor_failed\.png\?v=.+/);
  assert.equal(calls, 2);
  assert.equal(await readFile(path.join(imagesDirectory, "harbor_failed.png"), "utf8"), "retried image");
  assert.equal(await readFile(path.join(imagesDirectory, "harbor_success.png"), "utf8"), "original image");
  assert.equal((await request({ ...input, prompt: "Another version" })).status, 409);
  assert.equal(calls, 2, "completed images must not trigger another generation request");
});
