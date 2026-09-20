import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

for (const allImagesFail of [false, true]) {
  test(`article route saves text and completes when ${allImagesFail ? "all images fail" : "one image fails"}`, async (t) => {
    const oldEnvironment = { DATABASE_URL: process.env.DATABASE_URL, GEMINI_API_KEY: process.env.GEMINI_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
    process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.OPENAI_API_KEY = "test-openai";
    t.after(() => {
      for (const [name, value] of Object.entries(oldEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
    const { db } = await import("../db");
    const { POST } = await import("../app/api/articles/generate/route");
    const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-generation-route-"));
    const originalDirectory = process.cwd();
    process.chdir(directory);
    t.after(async () => {
      process.chdir(originalDirectory);
      await rm(directory, { recursive: true, force: true });
    });
    t.mock.method(console, "error", () => {});

    const source = { title: "Atlantis", slug: "atlantis", content: "A world beneath the sea." };
    let reads = 0;
    t.mock.method(db, "select", () => {
      const query = ++reads;
      return { from: () => ({ where: () => ({ limit: async () => query === 1 ? [source] : [], orderBy: async () => [source] }) }) };
    });
    let savedArticle: { content: string } | undefined;
    t.mock.method(db, "insert", () => ({ values: (article: { content: string }) => ({ onConflictDoUpdate: async () => { savedArticle = article; } }) }));

    const markdown = '# Harbor\n\n![Failed view](./images/harbor_failed.png "Harbor skyline")\n\nThe harbor remains readable.\n\n![Successful view](./images/harbor_success.png "Harbor market")\n\n' + "Article prose. ".repeat(3000);
    const articleFile = path.join(directory, "wiki-files/atlantis/harbor.md");
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("generativelanguage.googleapis.com")) {
        const request = JSON.parse(String(init?.body));
        const prompt = request.messages[0].content as string;
        assert.ok(prompt.includes("Article URL slug: harbor"));
        assert.ok(prompt.includes(`<referring_article>\n${source.content}\n</referring_article>`));
        assert.ok(prompt.includes("MAIN PAGE:"));
        const catalogue = prompt.split("<existing_articles>\n")[1].split("\n</existing_articles>")[0];
        assert.equal(catalogue, "- Title: Atlantis\n  Slug: atlantis");
        assert.ok(!prompt.includes("<world_overview_brief>"));
        const event = { choices: [{ index: 0, delta: { content: markdown }, finish_reason: "stop" }] };
        return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      }
      assert.equal(String(url), "https://api.openai.com/v1/images/generations");
      // Both storage destinations must contain the article before any image request.
      assert.equal(savedArticle?.content, markdown.trim());
      assert.ok((await readFile(articleFile, "utf8")).includes(markdown.trim()));
      const request = JSON.parse(String(init?.body));
      assert.ok(request.prompt.length <= 32_000);
      const fail = allImagesFail || request.prompt.includes("IMAGE REQUIRED:\n\nFailed view");
      return new Response(JSON.stringify(fail ? { error: { message: "Image rejected", type: "invalid_request_error" } } : { data: [{ b64_json: Buffer.from("image bytes").toString("base64") }] }), {
        status: fail ? 400 : 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const response = await POST(new Request("http://localhost/api/articles/generate", { method: "POST", body: JSON.stringify({ wiki: "atlantis", slug: "harbor", title: "Harbor", sourceSlug: "atlantis" }) }));
    const messages = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(messages.filter((message) => message.type === "image-error").length, allImagesFail ? 2 : 1);
    assert.equal(messages.filter((message) => message.type === "image-done").length, allImagesFail ? 0 : 1);
    assert.equal(messages.some((message) => message.type === "error"), false);
    assert.deepEqual(messages.at(-1), { type: "done", slug: "harbor" });
    assert.equal(savedArticle?.content, markdown.trim());
    assert.ok((await readFile(articleFile, "utf8")).includes("The harbor remains readable."));
  });
}
