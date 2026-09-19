import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { WikiImage } from "../components/wiki-image";
import { remarkSubjectInfobox } from "./remark-subject-infobox";
import { imageSource, prepareWikiLinks } from "./wiki";

function render(markdown: string, savedPage = true) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, [remarkSubjectInfobox, { title: "Atlantis", wiki: "atlantis", slug: "atlantis" }]],
    rehypePlugins: savedPage ? [rehypeRaw] : [],
    components: {
      img: ({ src, alt, title, className }) => createElement(WikiImage, {
        src: imageSource(String(src), "atlantis")!,
        alt: alt ?? "",
        caption: title ?? alt,
        priority: className?.includes("wiki-subject-image"),
      }),
    },
  }, prepareWikiLinks(markdown, "atlantis")));
}

const article = `# Atlantis

**Atlantis** has a capital called [[Nacre|the reef capital]].

## Geography

![Detailed view of the capital](./images/atlantis_main.png "Capital of the underwater civilisation.")

[[Nacre]] is part of [[Atlantis]]. It trades with [[Surface nations]] and [[Deep cities]].

![Second view](./images/atlantis_other.png "The seabed.")
`;

for (const savedPage of [true, false]) {
  test(`subject infobox precedes the lead in the ${savedPage ? "saved page" : "streaming preview"}`, () => {
    const html = render(article, savedPage);
    const start = html.indexOf('<aside class="wiki-infobox"');
    const end = html.indexOf("</aside>");
    assert.ok(start > html.indexOf("<h1>Atlantis</h1>"));
    assert.ok(end < html.indexOf("has a capital"));
    const box = html.slice(start, end);
    assert.match(box, /<strong>Atlantis<\/strong>/);
    assert.match(box, /Capital of the underwater civilisation\./);
    assert.match(box, /loading="eager"/);
    assert.match(box, /\/w\/atlantis\/nacre\?title=Nacre/);
    assert.equal((box.match(/>the reef capital<\/a>/g) ?? []).length, 1);
    assert.doesNotMatch(box, /title=Atlantis"/);
    assert.equal((html.match(/<img[^>]*atlantis_main.png/g) ?? []).length, 1);
    assert.ok(html.indexOf('alt="Second view"') > end);
    assert.match(html, /alt="Second view" loading="lazy"/);
  });
}

test("saved content without an H1 still puts the infobox first", () => {
  const html = render(article.replace("# Atlantis\n", ""));
  assert.ok(html.indexOf("<aside") < html.indexOf("<p>"));
});

test("code samples and incomplete streamed image syntax do not become subject images", () => {
  assert.doesNotMatch(render('```md\n![Example](./images/example.png)\n```\n\n![Unfinished'), /<aside/);
});

test("image promotion preserves adjacent text and standard tables", () => {
  const html = render('Before ![Subject](./images/atlantis_main.png "Subject.") after.\n\n| Era | Name |\n| --- | --- |\n| 1 | Ancient |');
  assert.match(html, /<p>Before  after\.<\/p>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(render("An older article without images."), /<aside/);
});
