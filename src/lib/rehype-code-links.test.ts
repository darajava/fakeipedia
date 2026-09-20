import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { rehypeCodeLinks } from "./rehype-code-links";
import { prepareWikiLinks } from "./wiki";

function render(markdown: string, saved: boolean) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: saved ? [rehypeRaw, rehypeKatex, rehypeCodeLinks] : [rehypeKatex, rehypeCodeLinks],
  }, prepareWikiLinks(markdown, "women-rule")));
}

for (const saved of [true, false]) {
  const view = saved ? "saved article" : "streaming preview";
  test(`preformatted table links render without changing whitespace in the ${view}`, () => {
    const html = render('```text\n┌──────────┐\n│ [[Geneva]]  │\n│ [Kyoto](/women-rule/kyoto)   │\n└──────────┘\n```', saved);
    assert.match(html, /<pre><code class="language-text">┌──────────┐\n│ <a href="\/women-rule\/geneva\?title=Geneva">Geneva<\/a>  │\n│ <a href="\/women-rule\/kyoto">Kyoto<\/a>   │\n└──────────┘\n<\/code><\/pre>/);
    assert.match(render('    [[Aspen]]\n', saved), /<pre><code><a href="\/women-rule\/aspen\?title=Aspen">Aspen<\/a>\n<\/code><\/pre>/);
  });

  test(`block links remain safe and incomplete links remain readable in the ${view}`, () => {
    const html = render('```\n[external](https://example.com)\n[unsafe](javascript:alert)\n<a href="/wiki/raw">raw</a>\n![image](/wiki/image)\n[unfinished](/women-rule/gen\n```', saved);
    assert.match(html, /<a href="https:\/\/example.com">external<\/a>/);
    assert.doesNotMatch(html, /href="javascript:|<a href="\/wiki\/raw"|<img/);
    assert.match(html, /&lt;a href=/);
    assert.match(html, /!\[image\]\(\/wiki\/image\)/);
    assert.match(html, /\[unfinished\]\(\/women-rule\/gen/);
    assert.doesNotMatch(render('`[[Geneva]]`', saved), /<a /);
    assert.match(render('```math\nx^2\n```', saved), /class="katex-display"/);
  });
}
