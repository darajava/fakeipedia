import assert from "node:assert/strict";
import test from "node:test";
import { findWorldOverviewBrief } from "./world-overview";

const stub = {
  slug: "stub-atlantis",
  title: "Atlantis",
  content: "A broad world brief. [[Atlantis|Enter this wiki]]",
};

test("last link identifies the overview regardless of section headings", () => {
  const brief = { ...stub, content: "Suggested [[Nacre]]\n\n## Target article\n\n[[Atlantis]]\n\n## Notes\n[[Other]]" };
  assert.equal(findWorldOverviewBrief([brief], "atlantis", "other"), brief);
  assert.equal(findWorldOverviewBrief([brief], "atlantis", "atlantis"), undefined);
  assert.equal(findWorldOverviewBrief([brief], "atlantis", "nacre"), undefined);
});

test("overview brief is available when the reader arrives from another article", () => {
  const source = {
    slug: "nacre",
    title: "Nacre",
    content: "The capital of [[Atlantis]].",
  };
  assert.equal(
    findWorldOverviewBrief([source, stub], "atlantis", "atlantis"),
    stub,
  );
  assert.equal(
    findWorldOverviewBrief([source], "atlantis", "atlantis"),
    undefined,
  );
});

test("ordinary targets and cross-world references are not featured entry points", () => {
  assert.equal(findWorldOverviewBrief([stub], "atlantis", "nacre"), undefined);
  assert.equal(
    findWorldOverviewBrief(
      [{ ...stub, content: "[Atlantis](/w/another/atlantis)" }],
      "atlantis",
      "atlantis",
    ),
    undefined,
  );
  assert.equal(
    findWorldOverviewBrief(
      [{ ...stub, content: "[[Atlantis]] [[Nacre]]" }],
      "atlantis",
      "atlantis",
    ),
    undefined,
  );
});
