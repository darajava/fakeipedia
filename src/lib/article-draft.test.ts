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
