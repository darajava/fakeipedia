import assert from "node:assert/strict";
import test from "node:test";
import { articleDraftIssues, extractArticleImages, generateArticleDraft } from "./article-draft";

const image = (index: number) => `![An illustration of district ${index}](./images/atlantis_${index}.png "District ${index}.")`;
const ordinary = `# Atlantis\n\n${image(0)}\n\nAn underwater civilisation.`;
const featured = `# Atlantis\n\n${Array.from({ length: 5 }, (_, index) => image(index)).join("\n\n")}\n\n` +
  Array.from({ length: 8 }, (_, index) => `## Topic ${index}\n\n${"Substantial article prose. ".repeat(80)}`).join("\n\n");

test("featured requirements check prose, broad sections and five distinct images", () => {
  assert.deepEqual(articleDraftIssues(featured, "atlantis", true), []);
  const issues = articleDraftIssues(ordinary, "atlantis", true);
  assert.equal(issues.length, 3);
  assert.match(issues.join(" "), /exactly 5/);
  assert.match(issues.join(" "), /2,000 words/);
  assert.match(issues.join(" "), /8–10/);
});

test("ordinary articles require a subject image with a caption and supported local path", () => {
  assert.deepEqual(articleDraftIssues(ordinary, "atlantis", false), []);
  for (const markdown of ["Text only", ordinary.replace(' "District 0."', ""), ordinary.replace("atlantis_0", "other_0")]) {
    assert.ok(articleDraftIssues(markdown, "atlantis", false).length);
  }
  assert.equal(extractArticleImages(ordinary, "atlantis")[0].filename, "atlantis_0.png");
});

test("image limits cannot be bypassed by duplicates, extra images or long alt text", () => {
  assert.ok(articleDraftIssues(featured + image(0), "atlantis", true).length);
  assert.ok(articleDraftIssues(featured + image(5), "atlantis", true).length);
  assert.ok(articleDraftIssues(featured + image(5), "atlantis", false).length);
  const verboseImages = featured.replace(/## Topic [\s\S]*/, "").replace("district 0", "district ".repeat(2000));
  assert.match(articleDraftIssues(verboseImages, "atlantis", true).join(" "), /2,000 words/);
});

test("valid drafts stream once without requesting a revision", async () => {
  let calls = 0;
  const messages: object[] = [];
  const result = await generateArticleDraft({ prompt: "Original requirements", slug: "atlantis", isWorldOverview: false }, (message) => messages.push(message), async function* (prompt) {
    calls++;
    assert.equal(prompt, "Original requirements");
    yield ordinary;
  });
  assert.equal(result, ordinary);
  assert.equal(calls, 1);
  assert.deepEqual(messages, [{ type: "delta", delta: ordinary }]);
});

test("a nonconforming draft fails after one request without a revision or preview reset", async () => {
  const prompts: string[] = [];
  const messages: object[] = [];
  await assert.rejects(generateArticleDraft({ prompt: "World brief: underwater society", slug: "atlantis", isWorldOverview: true }, (message) => messages.push(message), async function* (prompt) {
    prompts.push(prompt);
    yield ordinary;
  }), /does not meet its requirements/);
  assert.deepEqual(prompts, ["World brief: underwater society"]);
  assert.deepEqual(messages, [{ type: "delta", delta: ordinary }]);
});

test("an interrupted response propagates without attempting to revise partial text", async () => {
  let calls = 0;
  await assert.rejects(generateArticleDraft({ prompt: "Brief", slug: "atlantis", isWorldOverview: false }, () => {}, async function* () {
    calls++;
    yield ordinary;
    throw new Error("Connection interrupted");
  }), /Connection interrupted/);
  assert.equal(calls, 1);
});

test("allows Unicode and ASCII diagrams in fenced, indented and ordinary text", () => {
  for (const diagram of [
    "```\nRaw Exfiltrated Relational Data (71.4 PB)\n       │\n       ▼\n[Deterministic B-Tree Indexer]\n┌──────┴──────┐\n[Phone]    [Civic ID]\n```",
    "~~~text\n[A] --> [B]\n~~~",
    "    [A]\n     |\n     v\n    [B]",
    "[A]\n│\n▼\n[B]",
    "[A] --> [B]",
    "```\n+----------+\n| Atlantis |\n+----------+\n```",
  ]) {
    assert.deepEqual(articleDraftIssues(`${ordinary}\n\n${diagram}`, "atlantis", false), []);
    assert.deepEqual(articleDraftIssues(`${featured}\n\n${diagram}`, "atlantis", true), []);
  }
});

test("keeps ordinary tables, lists, inline code, code examples and TeX valid", () => {
  const content = `${ordinary}\n\n| Era | People |\n| --- | --- |\n| First | 200 |\n\n1. Index the records.\n2. Search by name.\n\nUse \`a --> b\` as notation.\n\n\`\`\`js\nconst total = 3 + 4;\n\`\`\`\n\n$$\n\\begin{vmatrix}a & b \\\\ c & d\\end{vmatrix}\n$$`;
  assert.deepEqual(articleDraftIssues(content, "atlantis", false), []);
});

test("a diagram-containing draft is returned for persistence without a revision", async () => {
  let calls = 0;
  const diagram = "\n\n```\n[A]\n│\n▼\n[B]\n```\n\nThe districts are connected.";
  const messages: object[] = [];
  const result = await generateArticleDraft({ prompt: "No text diagrams", slug: "atlantis", isWorldOverview: false }, (message) => messages.push(message), async function* () {
    calls++;
    yield ordinary;
    yield diagram;
  });
  assert.equal(result, ordinary + diagram);
  assert.equal(calls, 1);
  assert.deepEqual(messages, [{ type: "delta", delta: ordinary }, { type: "delta", delta: diagram }]);
});
