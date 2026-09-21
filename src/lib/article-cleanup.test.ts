import assert from "node:assert/strict";
import test from "node:test";
import { removeAsciiTables } from "./article-cleanup";
import { generateArticleDraft } from "./article-draft";

const ascii = "+--------------+-----------+\n| City         | People    |\n+--------------+-----------+\n| Atlantis     | 200       |\n+--------------+-----------+";
const unicode = "┌──────┬──────────────┐\n│ Year │ Event        │\n├──────┼──────────────┤\n│ 2015 │ Founded      │\n└──────┴──────────────┘";

for (const table of [ascii, unicode, "╔════════════╗\n║ Timeline   ║\n║ 2015: Start║\n╚════════════╝"]) {
  for (const wrap of [
    (text: string) => text,
    (text: string) => `\`\`\`\nTable title\n${text}\n\`\`\``,
    (text: string) => `~~~text\n${text}\n~~~`,
    (text: string) => text.split("\n").map((line) => `    ${line}`).join("\n"),
  ]) {
    test(`removes boxed table: ${JSON.stringify(wrap(table).slice(0, 50))}`, () => {
      const cleaned = removeAsciiTables(`Before.\n\n${wrap(table)}\n\nAfter.`);
      assert.equal(cleaned.trim().replace(/\n{3,}/g, "\n\n"), "Before.\n\nAfter.");
      assert.equal(removeAsciiTables(cleaned), cleaned);
    });
  }
}

test("preserves real tables, code, prose, links, images, lists, diagrams and math exactly", () => {
  const content = [
    "# Article\n\nText with `| a | b |` and [[City]].",
    "![Subject](./images/city_main.png \"Caption\")",
    "| City | People |\n| --- | ---: |\n| Atlantis | 200 |",
    '<table><tr><th colspan="2">Cities</th></tr><tr><td>A</td><td>200</td></tr></table>',
    `\`\`\`js\nconst example = \`${ascii}\`;\n\`\`\``,
    "- First\n- Second\n\n---\n\n1. One\n2. Two",
    "```\n[A] --> [B]\n```",
    "$$\n\\begin{vmatrix}a & b \\\\ c & d\\end{vmatrix}\n$$",
  ].join("\n\n");
  assert.equal(removeAsciiTables(content), content);
});

test("removes multiple tables without consuming adjacent prose or valid tables", () => {
  const content = `Opening.\n${ascii}\nKeep this.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n${unicode}\nClosing.`;
  assert.equal(removeAsciiTables(content), "Opening.\nKeep this.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nClosing.");
});

test("cleans completed drafts in a single model request before persistence", async () => {
  const article = '# Atlantis\n\n![City](./images/atlantis_main.png "City")\n\nIntroduction.';
  const generated = `${article}\n\n\`\`\`text\n${ascii}\n\`\`\`\n\nClosing prose.`;
  let calls = 0;
  const result = await generateArticleDraft({ prompt: "Brief", slug: "atlantis", isWorldOverview: false }, () => {}, async function* () {
    calls++;
    for (let index = 0; index < generated.length; index += 13) yield generated.slice(index, index + 13);
  });
  assert.equal(calls, 1);
  assert.equal(result, `${article}\n\n\n\nClosing prose.`);
});
