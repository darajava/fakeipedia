import assert from "node:assert/strict";
import test from "node:test";
import { articleLink, articlePath, imageSource, linkedArticleSlugs, prepareWikiLinks, validSlug } from "./wiki";

test("wiki links keep their world and display labels", () => {
  assert.equal(
    prepareWikiLinks("[[Helion system|the system]] and [[Zorg]]", "zorg"),
    "[the system](/w/zorg/helion-system?title=Helion%20system) and [Zorg](/w/zorg/zorg?title=Zorg)",
  );
  assert.equal(articlePath("rome", "history"), "/w/rome/history");
  assert.equal(articlePath("zorg", "history"), "/w/zorg/history");
});

test("article URLs omit the generation title but preserve other query parameters and fragments", () => {
  const link = articleLink("/wiki/history?title=Ancient%20history&view=full#origins", "rome");
  assert.equal(link?.wiki, "rome");
  assert.equal(link?.slug, "history");
  assert.equal(link?.title, "Ancient history");
  assert.equal(link?.href, "/w/rome/history?view=full#origins");
});

test("rendered wiki links have clean URLs and retain the exact title for missing articles", () => {
  const markdown = prepareWikiLinks("[[Helion system|the system]]", "zorg");
  const href = markdown.match(/\]\(([^)]+)\)/)?.[1];
  const link = articleLink(href, "zorg");
  assert.equal(link?.href, "/w/zorg/helion-system");
  assert.equal(link?.title, "Helion system");
});

test("explicit cross-wiki links are preserved and not counted as local articles", () => {
  const markdown = '[[History]] [capital](/w/rome/capital) [Zorg](/w/zorg/zorg) <a href="/wiki/senate">Senate</a>';
  assert.deepEqual(linkedArticleSlugs(markdown, "rome"), ["history", "capital", "senate"]);
  assert.equal(articleLink("/w/zorg/zorg", "rome")?.href, "/w/zorg/zorg");
});

test("article action and external links are not treated as article references", () => {
  assert.equal(articleLink("/w/zorg/history/generate", "zorg"), undefined);
  assert.equal(articleLink("https://example.com/w/zorg/history", "zorg"), undefined);
  assert.equal(articleLink("/w/zorg/%ZZ", "zorg"), undefined);
});

test("images with matching names use separate wiki directories", () => {
  assert.equal(imageSource("./images/history_map.png", "zorg"), "/wiki-images/zorg/history_map.png");
  assert.equal(imageSource("./images/history_map.png", "rome"), "/wiki-images/rome/history_map.png");
  assert.equal(imageSource("https://example.com/image.png", "rome"), "https://example.com/image.png");
});

test("wiki slugs cannot escape their directory", () => {
  for (const value of ["../zorg", "zorg/rome", "", "Zorg", "zorg?x=1"]) {
    assert.equal(validSlug(value), false);
  }
  assert.equal(validSlug("roman-empire"), true);
});
