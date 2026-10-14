import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import { articleHeadings, prepareArticleMarkdown, rehypeArticleHeadings } from "./article-headings";
import { WikiTableOfContents } from "../components/wiki-table-of-contents";

test("contents match rendered anchors for formatted, duplicate, Unicode and HTML headings", () => {
  const markdown = prepareArticleMarkdown(`# Harbour\n\n## **History** & [[Old Town|origins]]\n\n### Early \`ships\`\n\n## History\n\n## History\n\n## History-1\n\n## 日本語\n\n## Energy $E=mc^2$\n\n<h2 id="custom">Later <em>years</em></h2>\n\n\`\`\`md\n## Not a section\n\`\`\`\n`, "world");
  const headings = articleHeadings(markdown);
  assert.deepEqual(headings.map(({ title }) => title), ["History & origins", "Early ships", "History", "History", "History-1", "日本語", "Energy E=mc^2", "Later years"]);
  assert.equal(new Set(headings.map(({ id }) => id)).size, headings.length);
  assert.equal(headings.at(-1)!.id, "custom");
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [rehypeRaw, rehypeArticleHeadings, rehypeKatex],
  }, markdown));
  for (const heading of headings) assert.ok(html.includes(`<h${heading.depth} id="${heading.id}">`), heading.id);
  const contents = renderToStaticMarkup(createElement(WikiTableOfContents, { headings }));
  for (const heading of headings) assert.ok(contents.includes(`href="#${encodeURIComponent(heading.id)}"`), heading.id);
  assert.doesNotMatch(contents, /Not a section|Harbour/);
});

test("contents respect nested sections, skipped heading levels and setext headings", () => {
  const headings = articleHeadings("Origins\n-------\n\n#### First settlements\n\n### Trade\n\n## Today");
  assert.deepEqual(headings.map(({ depth }) => depth), [2, 4, 3, 2]);
  const html = renderToStaticMarkup(createElement(WikiTableOfContents, { headings }));
  assert.match(html, /Origins<\/a><ul><li>.*First settlements<\/a><\/li><li>.*Trade<\/a><\/li><\/ul><\/li><li>.*Today/);
});

test("articles without sections omit contents and generated anchors avoid existing IDs", () => {
  assert.equal(renderToStaticMarkup(createElement(WikiTableOfContents, { headings: articleHeadings("# Title\n\nPlain text.") })), "");
  const headings = articleHeadings('<div id="history"></div>\n\n## History\n\n<h2 id="history-1">Custom</h2>\n\n<h2 id="history-1">Repeated custom ID</h2>');
  assert.deepEqual(headings.map(({ id }) => id), ["history-2", "history-1", "history-1-1"]);
});
