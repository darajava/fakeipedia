import assert from "node:assert/strict";
import test from "node:test";
import { buildArticleContext } from "./article-context";

const source = { title: "Source", slug: "source", content: "Source text. [[Harbor]]" };
const main = { title: "Ocean World", slug: "ocean-world", content: "Complete main page. " + "World history. ".repeat(100) };
const stub = { title: "Brief", slug: "stub-ocean", content: "Suggested [[Other]]\n\n## Target article\n\n[[Ocean World]]" };

test("includes ten full backlinks with source first, plus the published main page", () => {
  const linking = Array.from({ length: 11 }, (_, i) => ({
    title: `Article ${i}`, slug: `article-${i}`, content: `Full article ${i}. ${"History. ".repeat(100)} [[Harbor|Port]]`,
  }));
  const unrelated = { title: "Unrelated", slug: "unrelated", content: "This text must not be included." };
  const context = buildArticleContext([stub, main, ...linking, source, unrelated], "ocean", "harbor", source);
  assert.equal((context.referringText.match(/<referring_article>/g) ?? []).length, 10);
  assert.ok(context.referringText.startsWith("Article title: Source"));
  assert.ok(context.referringText.includes(source.content));
  for (const article of linking.slice(0, 9)) assert.ok(context.referringText.includes(article.content));
  for (const article of [...linking.slice(9), unrelated, stub]) assert.ok(!context.referringText.includes(article.content));
  assert.ok(context.mainText.includes(main.content));
  assert.ok(!context.mainText.includes(stub.content));
  assert.equal(context.catalogue, [stub, main, ...linking, source, unrelated]
    .map((article) => `- Title: ${article.title}\n  Slug: ${article.slug}`).join("\n"));
});

test("backlinks follow rendered links and exclude other wikis and inline code", () => {
  const rows = [
    { title: "Markdown", slug: "markdown", content: "[Port](/w/ocean/harbor#history)" },
    { title: "Legacy", slug: "legacy", content: "[Port](/wiki/harbor)" },
    { title: "Other world", slug: "other-world", content: "[Port](/w/elsewhere/harbor)" },
    { title: "Code", slug: "code", content: "`[[Harbor]]`" },
  ];
  const context = buildArticleContext(rows, "ocean", "harbor", source);
  assert.ok(context.referringText.includes(rows[0].content));
  assert.ok(context.referringText.includes(rows[1].content));
  assert.ok(!context.referringText.includes(rows[2].content));
  assert.ok(!context.referringText.includes(rows[3].content));
});

test("main page already included as a backlink is identified without duplicating its text", () => {
  const context = buildArticleContext([stub, main], "ocean", "harbor", main);
  assert.ok(context.referringText.includes(main.content));
  assert.ok(context.mainText.includes("Article slug: ocean-world"));
  assert.ok(!context.mainText.includes(main.content));
});

test("missing main page never falls back to the stub, including initial main-page generation", () => {
  const context = buildArticleContext([stub], "ocean", "ocean-world", stub);
  assert.equal(context.mainText, "");
  assert.ok(context.referringText.includes(stub.content));
});

test("uses a wiki-named main page when there is no stub", () => {
  const context = buildArticleContext([{ ...main, slug: "ocean" }], "ocean", "harbor", source);
  assert.ok(context.mainText.includes(main.content));
});
