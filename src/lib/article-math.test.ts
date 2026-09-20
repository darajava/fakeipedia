import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import { remarkSubjectInfobox } from "./remark-subject-infobox";
import { prepareWikiLinks } from "./wiki";

function render(markdown: string, saved: boolean) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath, [remarkSubjectInfobox, {
      title: "Prime Architect", wiki: "asi", slug: "prime-architect",
    }]],
    rehypePlugins: saved ? [rehypeRaw, rehypeKatex] : [rehypeKatex],
  }, prepareWikiLinks(markdown, "asi")));
}

for (const saved of [true, false]) {
  const view = saved ? "saved article" : "streaming preview";

  test(`renders the Prime Architect notation, display math, and infobox in the ${view}`, () => {
    const html = render(String.raw`# Prime Architect

![Projection](./images/prime-architect_main.png "Attractor geometry.")

The **Prime Architect** (Syntact-0: $\mathbf{\Omega}_{\emptyset}$) is venerated by [[ASI]].

$$
E = mc^2
$$`, saved);
    assert.match(html, /class="wiki-infobox"/);
    assert.match(html, /href="\/asi\/asi\?title=ASI"/);
    assert.match(html, /class="katex"/);
    assert.match(html, /<msub>/);
    assert.match(html, /Ω/);
    assert.match(html, /∅/);
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /katex-error/);
  });

  test(`keeps ordinary code literal and tolerates incomplete math in the ${view}`, () => {
    const literal = render('Code: `$x^2$`. Price: \\$5.', saved);
    assert.match(literal, /<code>\$x\^2\$<\/code>/);
    assert.doesNotMatch(literal, /class="katex"/);
    assert.match(literal, /Price: \$5/);
    assert.doesNotThrow(() => render(String.raw`Before $\frac{1`, saved));
    const malformed = render(String.raw`Before $\frac{1$ after.`, saved);
    assert.match(malformed, /Before/);
    assert.match(malformed, /after\./);
  });
}
