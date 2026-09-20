import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import OpenAI from "openai";
import { buildArticleImagePrompt, generateArticleImages, type ArticleImageMessage } from "./article-images";

const image = (name: string) => `![Illustrate ${name}](./images/atlantis_${name}.png "${name} caption")`;
const options = { wiki: "atlantis", slug: "atlantis", title: "Atlantis" };

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

test("caps long prompts while retaining image instructions and the start of the article", () => {
  const markdown = "Article opening. " + "x".repeat(36_278) + "Article ending.";
  const description = "A close view of a coral council chamber, warm light, no people.";
  const prompt = buildArticleImagePrompt("Atlantis", markdown, description);
  assert.equal(prompt.length, 32_000);
  assert.ok(prompt.includes(description));
  assert.ok(prompt.includes("Article opening."));
  assert.ok(prompt.includes("No writing, captions, labels, logos or watermarks."));
  assert.ok(prompt.endsWith("\n</article>"));
  assert.ok(!prompt.includes("Article ending."));
  assert.equal(markdown.length, 36_310);
});

test("preserves short article context and safely caps unusually long titles and descriptions", () => {
  assert.ok(buildArticleImagePrompt("Atlantis", "Full short article.", "Coral city.").includes("Full short article."));
  for (const description of ["x".repeat(40_000), "🌊".repeat(40_000)]) {
    const prompt = buildArticleImagePrompt("🌊".repeat(200), "🌊".repeat(40_000), description);
    assert.ok(prompt.length <= 32_000);
    assert.equal(Buffer.from(prompt).toString(), prompt, "must not split a surrogate pair");
    assert.ok(prompt.endsWith("\n</article>"));
  }
  const emptyLength = buildArticleImagePrompt("Atlantis", "", "Coral city.").length;
  const exact = "x".repeat(32_000 - emptyLength);
  assert.equal(buildArticleImagePrompt("Atlantis", exact, "Coral city.").length, 32_000);
  assert.equal(buildArticleImagePrompt("Atlantis", exact + "overflow", "Coral city.").length, 32_000);
});

test("an image API failure leaves successful images intact and waits for remaining images", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-generation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(console, "error", () => {});
  const messages: ArticleImageMessage[] = [];
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
  let sawFailure!: () => void;
  const failed = new Promise<void>((resolve) => { sawFailure = resolve; });
  const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/images/generations");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-image-2.5-flare");
    assert.ok(body.prompt.length <= 32_000);
    if (body.prompt.includes("IMAGE REQUIRED:\n\nIllustrate failed")) {
      return jsonResponse({ error: { message: "Image rejected", type: "invalid_request_error" } }, 400);
    }
    await slowGate;
    return jsonResponse({ data: [{ b64_json: Buffer.from("successful image").toString("base64") }] });
  } });
  let finished = false;
  const generation = generateArticleImages({ ...options, markdown: image("failed") + "\n\n" + image("success") + "\n" + "x".repeat(40_000) }, (message) => {
    messages.push(message);
    if (message.type === "image-error") sawFailure();
  }, { client, wikiDirectory: directory }).then(() => { finished = true; });
  await failed;
  assert.equal(finished, false);
  releaseSlow();
  await generation;
  assert.deepEqual(messages.filter((message) => message.type === "image-error"), [
    { type: "image-error", filename: "atlantis_failed.png", message: "Could not generate this image." },
  ]);
  assert.deepEqual(messages.at(-1), { type: "image-done", filename: "atlantis_success.png", url: "/wiki-images/atlantis/atlantis_success.png" });
  assert.equal(await readFile(path.join(directory, "atlantis/images/atlantis_success.png"), "utf8"), "successful image");
  assert.deepEqual(await readdir(path.join(directory, "atlantis/images")), ["atlantis_success.png"]);
});

test("all images may fail without rejecting the article's generation flow", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-empty-images-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(console, "error", () => {});
  const messages: ArticleImageMessage[] = [];
  const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async () => jsonResponse({ data: [] }) });
  await generateArticleImages({ ...options, markdown: image("one") + "\n\n" + image("two") }, (message) => messages.push(message), { client, wikiDirectory: directory });
  assert.equal(messages.filter((message) => message.type === "image-error").length, 2);
  assert.equal(messages.filter((message) => message.type === "image-done").length, 0);
});

test("image directory failures remain image errors without making an API request", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-image-directory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(console, "error", () => {});
  await writeFile(path.join(directory, "atlantis"), "not a directory");
  let calls = 0;
  const client = new OpenAI({ apiKey: "test", fetch: async () => { calls++; throw new Error("Unexpected request"); } });
  const messages: ArticleImageMessage[] = [];
  await generateArticleImages({ ...options, markdown: image("one") + "\n\n" + image("two") }, (message) => messages.push(message), { client, wikiDirectory: directory });
  assert.equal(calls, 0);
  assert.equal(messages.filter((message) => message.type === "image-error").length, 2);
});

test("a missing-image retry never overwrites an image created while generation is running", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-image-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(console, "error", () => {});
  const messages: ArticleImageMessage[] = [];
  const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: async () => {
    await writeFile(path.join(directory, "atlantis/images/atlantis_one.png"), "image that finished first");
    return jsonResponse({ data: [{ b64_json: Buffer.from("late retry").toString("base64") }] });
  } });
  await generateArticleImages({ ...options, markdown: image("one") }, (message) => messages.push(message), {
    client, wikiDirectory: directory, filename: "atlantis_one.png", onlyIfMissing: true,
  });
  assert.equal(await readFile(path.join(directory, "atlantis/images/atlantis_one.png"), "utf8"), "image that finished first");
  assert.equal(messages.filter((message) => message.type === "image-done").length, 0);
  assert.equal(messages.filter((message) => message.type === "image-error").length, 1);
  assert.deepEqual(await readdir(path.join(directory, "atlantis/images")), ["atlantis_one.png"]);
});
