import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";

// Opt in with LORE_TEST_DATABASE_URL. All tables and Markdown live in a fresh,
// disposable schema/directory; the configured database's real articles are untouched.
test("lore preparation and generation against PostgreSQL", { skip: !process.env.LORE_TEST_DATABASE_URL }, async (t) => {
  const root = process.cwd();
  const schema = `lore_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: process.env.LORE_TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  for (const file of (await readdir(path.join(root, "drizzle"))).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = (await readFile(path.join(root, "drizzle", file), "utf8")).replaceAll('"public".', `"${schema}".`);
    await admin.query(sql);
  }
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-lore-test-"));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, GEMINI_API_KEY: process.env.GEMINI_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  const url = new URL(process.env.LORE_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.GEMINI_API_KEY = "test";
  process.env.OPENAI_API_KEY = "test";
  process.chdir(directory);
  const { db } = await import("../db");
  const { articleLockPool, acquireArticleLock, ArticleBusyError } = await import("./article-lock");
  const { POST: prepare } = await import("../app/api/articles/questions/route");
  const { generateArticleRequest: generate } = await import("./article-generation");
  const { ensureArticleQuestions } = await import("./article-question-store");
  t.after(async () => {
    process.chdir(root);
    await db.$client.end();
    await articleLockPool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(console, "error", () => {});
  let questionCalls = 0;
  let articleCalls = 0;
  let malformedQuestions = false;
  let failArticle = false;
  let onArticle: (prompt: string) => Promise<void> = async () => {};
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    if (String(url).includes("generativelanguage.googleapis.com")) {
      const prompt = request.messages[0].content as string;
      if (!request.stream) {
        questionCalls++;
        const data = JSON.parse(prompt.split("\n").at(-1)!);
        assert.ok(data.source.content);
        const questions = data.targets.map((target: { slug: string }) => ({ slug: target.slug, question: `What changed ${target.slug} after ${data.source.title}?` }));
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: malformedQuestions ? "{}" : JSON.stringify(questions) } }] });
      }
      articleCalls++;
      await onArticle(prompt);
      const slug = prompt.match(/Article URL slug: ([^\n]+)/)![1];
      const title = prompt.match(/Begin with exactly:\n\n# ([^\n]+)/)![1];
      const markdown = `# ${title}\n\n![A view](./images/${slug}_view.png "A view of the subject")\n\nThe guild refused the crown. [[Next Chapter]]\n\n## See also\n\n[[Next Chapter]]`;
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: markdown }, finish_reason: failArticle ? "length" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    assert.equal(String(url), "https://api.openai.com/v1/images/generations");
    return Response.json({ error: { message: "Test image failure", type: "invalid_request_error" } }, { status: 400 });
  });
  const insertSource = async (slug: string, content: string) => (await admin.query('INSERT INTO articles (wiki, slug, title, content) VALUES ($1,$2,$3,$4) RETURNING *', ["world", slug, slug, content])).rows[0];
  const request = (body: object) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
  const prep = (sourceSlug: string, slug: string, retry = false) => prepare(request({ wiki: "world", sourceSlug, slug, retry }));
  const messages = async (response: Response) => {
    assert.equal(response.status, 200);
    return (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  };

  await t.test("first visits cache source-specific questions and edits invalidate the cache", async () => {
    await insertSource("source", "The [[Glass Rebellion]] and [[Harbor]] changed the world.");
    const a = await (await prep("source", "glass-rebellion")).json();
    assert.match(a.question, /after source/);
    const before = questionCalls;
    const b = await (await prep("source", "harbor")).json();
    assert.equal(a.questionSetId, b.questionSetId);
    assert.equal(questionCalls, before);
    await insertSource("other", "The [[Glass Rebellion]] was remembered here.");
    const other = await (await prep("other", "glass-rebellion")).json();
    assert.notEqual(other.questionSetId, a.questionSetId);
    assert.notEqual(other.question, a.question);
    await admin.query("UPDATE articles SET content = content || ' Changed.' WHERE slug = 'source'");
    const edited = await (await prep("source", "glass-rebellion")).json();
    assert.notEqual(edited.questionSetId, a.questionSetId);
    assert.equal((await prep("source", "not-linked")).status, 400);
  });

  await t.test("concurrent question preparation returns pending without a duplicate model request", async () => {
    const row = await insertSource("locked", "[[Locked Target]]");
    const { questionContentHash } = await import("./article-questions");
    const release = await acquireArticleLock(`questions:${row.id}:${questionContentHash(row.content)}`);
    const before = questionCalls;
    assert.equal((await prep("locked", "locked-target")).status, 202);
    assert.equal(questionCalls, before);
    await release();
    assert.equal((await prep("locked", "locked-target")).status, 200);
    const lock = await acquireArticleLock("independent-lock");
    await assert.rejects(acquireArticleLock("independent-lock"), ArticleBusyError);
    await lock();
  });

  await t.test("fallback snapshots remain exact after a successful question retry", async () => {
    await insertSource("fallback-source", "[[Fallback Target]]");
    malformedQuestions = true;
    const fallback = await (await prep("fallback-source", "fallback-target")).json();
    assert.equal(fallback.fallback, true);
    malformedQuestions = false;
    const tailored = await (await prep("fallback-source", "fallback-target", true)).json();
    assert.equal(tailored.fallback, false);
    assert.notEqual(tailored.question, fallback.question);
    const body = { wiki: "world", slug: "fallback-target", title: "Fallback Target", sourceSlug: "fallback-source", questionSetId: fallback.questionSetId, fallbackQuestion: true, answer: "  A guild tradition.\n", requestId: crypto.randomUUID() };
    onArticle = async (prompt) => {
      const stored = (await admin.query("SELECT * FROM lore_contributions WHERE request_id = $1", [body.requestId])).rows[0];
      assert.equal(stored.answer, body.answer);
      assert.equal(stored.question, fallback.question);
      assert.equal(stored.status, "generating");
      assert.ok(prompt.includes(JSON.stringify({ question: fallback.question, answer: body.answer })));
    };
    const result = await messages(await generate(request(body)));
    assert.equal(result.at(-1).type, "done");
    assert.ok(result.some((message) => message.type === "image-error"));
    const row = (await admin.query("SELECT * FROM lore_contributions WHERE request_id = $1", [body.requestId])).rows[0];
    assert.equal(row.status, "succeeded");
    assert.ok(row.article_id);
    assert.ok((await readFile(path.join(directory, "wiki-files/world/fallback-target.md"), "utf8")).includes("The guild refused"));
    const calls = articleCalls;
    assert.equal((await generate(request(body))).status, 409);
    assert.equal(articleCalls, calls);
    onArticle = async () => {};
  });

  await t.test("failed generation retains one contribution and retry succeeds without duplication", async () => {
    const question = await (await prep("source", "glass-rebellion")).json();
    const body = { wiki: "world", slug: "glass-rebellion", title: "Glass Rebellion", sourceSlug: "source", questionSetId: question.questionSetId, answer: "The guild refused the crown.", requestId: crypto.randomUUID() };
    failArticle = true;
    const failed = await messages(await generate(request(body)));
    assert.equal(failed.at(-1).type, "error");
    assert.equal((await admin.query("SELECT status FROM lore_contributions WHERE request_id = $1", [body.requestId])).rows[0].status, "failed");
    failArticle = false;
    const different = await (await prep("other", "glass-rebellion")).json();
    assert.equal((await generate(request({ ...body, questionSetId: different.questionSetId }))).status, 400);
    assert.equal((await generate(request({ ...body, answer: "Changed input" }))).status, 400);
    malformedQuestions = true;
    const succeeded = await messages(await generate(request(body)));
    malformedQuestions = false;
    assert.equal(succeeded.at(-1).type, "done");
    const rows = (await admin.query("SELECT * FROM lore_contributions WHERE request_id = $1", [body.requestId])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "succeeded");
    const postQuestions = (await admin.query("SELECT status FROM article_question_sets WHERE source_article_id = $1", [rows[0].article_id])).rows;
    assert.equal(postQuestions[0].status, "failed");
  });

  await t.test("skipped generation has no contribution and concurrent attempts cannot overwrite it", async () => {
    await insertSource("skip-source", "[[Skipped]]");
    const body = { wiki: "world", slug: "skipped", title: "Skipped", sourceSlug: "skip-source", answer: " \n " };
    let modelStarted!: () => void;
    let releaseModel!: () => void;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const held = new Promise<void>((resolve) => { releaseModel = resolve; });
    onArticle = async (prompt) => { assert.ok(!prompt.includes("READER'S LORE CONTRIBUTION")); modelStarted(); await held; };
    const first = await generate(request(body));
    await started;
    const competing = await generate(request(body));
    assert.equal(competing.status, 409);
    assert.equal((await competing.json()).busy, true);
    releaseModel();
    assert.equal((await messages(first)).at(-1).type, "done");
    assert.equal((await admin.query("SELECT * FROM lore_contributions WHERE target_slug = 'skipped'")).rows.length, 0);
    onArticle = async () => {};
  });

  await t.test("a contribution-storage failure never calls the model", async () => {
    await insertSource("storage-source", "[[Storage Target]]");
    const question = await (await prep("storage-source", "storage-target")).json();
    const body = { wiki: "world", slug: "storage-target", title: "Storage Target", sourceSlug: "storage-source", questionSetId: question.questionSetId, answer: "A stored idea", requestId: crypto.randomUUID() };
    const before = articleCalls;
    const insert = t.mock.method(db, "insert", () => { throw new Error("Storage unavailable"); });
    const response = await generate(request(body));
    insert.mock.restore();
    assert.equal(response.status, 500);
    assert.equal(articleCalls, before);
  });

  await t.test("article and contribution commit together and a failed commit removes the generated file", async () => {
    await insertSource("rollback-source", "[[Rollback Target]]");
    const question = await (await prep("rollback-source", "rollback-target")).json();
    const body = { wiki: "world", slug: "rollback-target", title: "Rollback Target", sourceSlug: "rollback-source", questionSetId: question.questionSetId, answer: "A charter", requestId: crypto.randomUUID() };
    await admin.query(`CREATE FUNCTION reject_lore_success() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Commit unavailable'; END $$;
      CREATE TRIGGER reject_lore_success BEFORE UPDATE ON lore_contributions FOR EACH ROW WHEN (NEW.status = 'succeeded') EXECUTE FUNCTION reject_lore_success();`);
    const failed = await messages(await generate(request(body)));
    assert.equal(failed.at(-1).type, "error");
    assert.equal((await admin.query("SELECT * FROM articles WHERE slug = 'rollback-target'")).rows.length, 0);
    assert.equal((await admin.query("SELECT status FROM lore_contributions WHERE request_id = $1", [body.requestId])).rows[0].status, "failed");
    await assert.rejects(readFile(path.join(directory, "wiki-files/world/rollback-target.md")), { code: "ENOENT" });
    await admin.query("DROP TRIGGER reject_lore_success ON lore_contributions; DROP FUNCTION reject_lore_success()");
    assert.equal((await messages(await generate(request(body)))).at(-1).type, "done");
  });

  await t.test("disconnecting a reader does not lose their contribution or completed article", async () => {
    await insertSource("disconnect-source", "[[Disconnect Target]]");
    const question = await (await prep("disconnect-source", "disconnect-target")).json();
    const body = { wiki: "world", slug: "disconnect-target", title: "Disconnect Target", sourceSlug: "disconnect-source", questionSetId: question.questionSetId, answer: "A remembered custom", requestId: crypto.randomUUID() };
    let releaseModel!: () => void;
    let modelStarted!: () => void;
    const held = new Promise<void>((resolve) => { releaseModel = resolve; });
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    onArticle = async () => { modelStarted(); await held; };
    const response = await generate(request(body));
    await started;
    await response.body!.cancel();
    releaseModel();
    let finished = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const release = await acquireArticleLock("generation:world:disconnect-target");
        await release();
        finished = true;
        break;
      } catch (error) {
        if (!(error instanceof ArticleBusyError)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.equal(finished, true);
    assert.equal((await admin.query("SELECT status FROM lore_contributions WHERE request_id = $1", [body.requestId])).rows[0].status, "succeeded");
    assert.ok((await readFile(path.join(directory, "wiki-files/world/disconnect-target.md"), "utf8")).includes("The guild refused"));
    onArticle = async () => {};
  });

  await t.test("deleting a source preserves successful snapshots; deleting the target removes its discussion", async () => {
    await admin.query("DELETE FROM articles WHERE slug = 'fallback-source'");
    const row = (await admin.query("SELECT * FROM lore_contributions WHERE target_slug = 'fallback-target'")).rows[0];
    assert.equal(row.source_article_id, null);
    assert.equal(row.question_set_id, null);
    assert.equal(row.answer, "  A guild tradition.\n");
    await admin.query("DELETE FROM articles WHERE slug = 'fallback-target'");
    assert.equal((await admin.query("SELECT * FROM lore_contributions WHERE target_slug = 'fallback-target'")).rows.length, 0);
    const rowSource = (await admin.query("SELECT * FROM articles WHERE slug = 'source'")).rows[0];
    const result = await ensureArticleQuestions({ ...rowSource, wiki: "world" });
    assert.equal(result.status, "ready");
  });
});
