import assert from "node:assert/strict";
import test from "node:test";
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "../../next.config";

test("old wiki, article, generation and graph URLs permanently redirect with their query parameters", async () => {
  for (const path of [
    "/zorg",
    "/zorg?page=2",
    "/zorg/history",
    "/zorg/history/generate?title=Ancient%20History&source=zorg",
    "/zorg/explore/graph",
  ]) {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://fakeipedia.example/w${path}`,
      nextConfig,
    });
    assert.equal(response.status, 308);
    const actual = new URL(getRedirectUrl(response)!);
    const expected = new URL(`https://fakeipedia.example${path}`);
    assert.equal(actual.origin + actual.pathname, expected.origin + expected.pathname);
    assert.deepEqual([...actual.searchParams], [...expected.searchParams]);
  }
});

test("canonical wiki, API and image URLs do not redirect", async () => {
  for (const path of ["/zorg", "/zorg/history", "/api/wikis/zorg/graph", "/wiki-images/zorg/map.png"]) {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://fakeipedia.example${path}`,
      nextConfig,
    });
    assert.equal(getRedirectUrl(response), null);
  }
});
