import assert from "node:assert/strict";
import test from "node:test";
import { articleLink, articlePath, imageSource, linkedArticleSlugs, prepareWikiLinks, validSlug, validWikiSlug } from "./wiki";

test("wiki links keep their world and display labels", () => {
  assert.equal(
    prepareWikiLinks("[[Helion system|the system]] and [[Zorg]]", "zorg"),
    "[the system](/zorg/helion-system?title=Helion%20system) and [Zorg](/zorg/zorg?title=Zorg)",
  );
  assert.equal(articlePath("rome", "history"), "/rome/history");
  assert.equal(articlePath("zorg", "history"), "/zorg/history");
});

test("article URLs omit the generation title but preserve other query parameters and fragments", () => {
  const link = articleLink("/wiki/history?title=Ancient%20history&view=full#origins", "rome");
  assert.equal(link?.wiki, "rome");
  assert.equal(link?.slug, "history");
  assert.equal(link?.title, "Ancient history");
  assert.equal(link?.href, "/rome/history?view=full#origins");
});

test("rendered wiki links have clean URLs and retain the exact title for missing articles", () => {
  const markdown = prepareWikiLinks("[[Helion system|the system]]", "zorg");
  const href = markdown.match(/\]\(([^)]+)\)/)?.[1];
  const link = articleLink(href, "zorg");
  assert.equal(link?.href, "/zorg/helion-system");
  assert.equal(link?.title, "Helion system");
});

test("explicit cross-wiki links are preserved and not counted as local articles", () => {
  const markdown = '[[History]] [capital](/rome/capital) [Zorg](/zorg/zorg) <a href="/wiki/senate">Senate</a>';
  assert.deepEqual(linkedArticleSlugs(markdown, "rome"), ["history", "capital", "senate"]);
  assert.equal(articleLink("/zorg/zorg", "rome")?.href, "/zorg/zorg");
});

test("article action and external links are not treated as article references", () => {
  assert.equal(articleLink("/zorg/history/generate", "zorg"), undefined);
  assert.equal(articleLink("https://example.com/zorg/history", "zorg"), undefined);
  assert.equal(articleLink("/zorg/%ZZ", "zorg"), undefined);
});

test("old prefixed links resolve to canonical URLs without losing wiki, title, query or fragment", () => {
  const link = articleLink("/w/rome/history?title=Ancient%20Rome&view=full#origins", "zorg");
  assert.equal(link?.wiki, "rome");
  assert.equal(link?.title, "Ancient Rome");
  assert.equal(link?.href, "/rome/history?view=full#origins");
  assert.deepEqual(linkedArticleSlugs("[Old](/w/rome/history) [New](/rome/history) [Other](/w/zorg/history)", "rome"), ["history"]);
});

test("site routes and protocol-relative URLs are not article links", () => {
  for (const wiki of ["api", "w", "wiki", "wiki-images", "search", "random"]) {
    assert.equal(validWikiSlug(wiki), false);
    assert.equal(articleLink(`/w/${wiki}/history`, "zorg"), undefined);
    if (wiki !== "wiki") assert.equal(articleLink(`/${wiki}/history`, "zorg"), undefined);
    // Reserved wiki names remain valid article names within a world.
    assert.equal(articleLink(`/zorg/${wiki}`, "zorg")?.slug, wiki);
  }
  assert.equal(validWikiSlug("zorg"), true);
  assert.equal(articleLink("//example.com/history", "zorg"), undefined);
  assert.equal(articleLink("/zorg/history/generate", "zorg"), undefined);
  assert.equal(articleLink("/zorg/explore/graph", "zorg"), undefined);
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
