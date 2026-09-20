import assert from "node:assert/strict";
import test from "node:test";
import { wikipediaArticleUrl } from "./wikipedia";

const article = { pageid: 983, ns: 0, title: "Dublin" };
const reply = (pages: unknown[], title = "Dublin"): typeof fetch => async (input) =>
  new URL(String(input)).searchParams.get("action") === "opensearch"
    ? Response.json([title, [title], [], []])
    : Response.json({ query: { pages } });

test("links only after an exact-title lookup confirms an article", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://en.wikipedia.org");
    if (url.searchParams.get("action") === "opensearch") {
      assert.equal(url.searchParams.get("search"), "Dublin");
      assert.equal(url.searchParams.get("redirects"), "return");
      return Response.json(["Dublin", ["Dublin"], [], []]);
    }
    assert.equal(url.searchParams.get("titles"), "Dublin");
    assert.equal(url.searchParams.get("redirects"), "1");
    assert.equal(url.searchParams.has("list"), false);
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    return Response.json({ query: { pages: [article] } });
  };
  assert.equal(await wikipediaArticleUrl("Dublin", fetcher), "https://en.wikipedia.org/wiki/Dublin");
});

test("permits Wikipedia title normalization and safely encodes the link", async () => {
  const title = "Café (city)";
  assert.equal(
    await wikipediaArticleUrl(" cafe\u0301_(city) ", reply([{ ...article, title }], title)),
    "https://en.wikipedia.org/wiki/Caf%C3%A9_(city)",
  );
});

test("hides missing, invalid, redirected, differently named, and non-article pages", async () => {
  for (const page of [
    { ns: 0, title: "Dublin", missing: true },
    { ...article, invalid: true },
    { ...article, redirect: true },
    { ...article, title: "Dublin (disambiguation)" },
    { ...article, ns: 1 },
    { ...article, pageid: -1 },
    null,
  ]) {
    assert.equal(await wikipediaArticleUrl("Dublin", reply([page])), null);
  }
  assert.equal(await wikipediaArticleUrl("Dublin", reply([])), null);
  assert.equal(await wikipediaArticleUrl("Dublin", reply([article, article])), null);
});

test("hides the note when Wikipedia is unavailable or returns an unexpected response", async () => {
  for (const fetcher of [
    async () => new Response("Unavailable", { status: 503 }),
    async () => new Response("not json"),
    async () => Response.json({ error: { code: "ratelimited" } }),
    async () => Response.json({ query: { pages: {} } }),
    async () => { throw new DOMException("Timed out", "TimeoutError"); },
  ]) {
    assert.equal(await wikipediaArticleUrl("Dublin", fetcher), null);
  }
});

test("does not turn blank titles, title lists, or section links into article matches", async () => {
  const fetcher: typeof fetch = async () => { throw new Error("Should not fetch"); };
  for (const title of ["", "  ", "Dublin|London", "Dublin#History"]) {
    assert.equal(await wikipediaArticleUrl(title, fetcher), null);
  }
});

test("recognises the Kennedy article through its same-name alias despite capitalisation", async () => {
  const alias = "John F kennedy assassination";
  const canonical = "Assassination of John F. Kennedy";
  const fetcher: typeof fetch = async (input) => {
    const query = new URL(String(input)).searchParams;
    if (query.get("action") === "opensearch") {
      return Response.json([query.get("search"), [alias, "John F. Kennedy assassination rifle"], [], []]);
    }
    assert.equal(query.get("titles"), alias);
    return Response.json({ query: {
      redirects: [{ from: alias, to: canonical }],
      pages: [{ pageid: 286369, ns: 0, title: canonical }],
    } });
  };
  assert.equal(await wikipediaArticleUrl("John F Kennedy Assassination", fetcher),
    "https://en.wikipedia.org/wiki/Assassination_of_John_F._Kennedy");
});

test("rejects related search results when none has the full matching name", async () => {
  const fetcher: typeof fetch = async (input) => {
    assert.equal(new URL(String(input)).searchParams.get("action"), "opensearch");
    return Response.json(["Dublin", ["Dublin (disambiguation)", "Dublin County"], [], []]);
  };
  assert.equal(await wikipediaArticleUrl("Dublin", fetcher), null);
});

test("rejects broken redirects and redirects to a section of another article", async () => {
  for (const target of [
    { page: { ns: 0, title: "Target", missing: true }, redirect: { from: "Dublin", to: "Target" } },
    { page: { ...article, title: "Target" }, redirect: { from: "Dublin", to: "Target", tofragment: "Dublin" } },
  ]) {
    const fetcher: typeof fetch = async (input) =>
      new URL(String(input)).searchParams.get("action") === "opensearch"
        ? Response.json(["Dublin", ["Dublin"], [], []])
        : Response.json({ query: { pages: [target.page], redirects: [target.redirect] } });
    assert.equal(await wikipediaArticleUrl("Dublin", fetcher), null);
  }
});
