import assert from "node:assert/strict";
import test from "node:test";
import { readPublicHandle } from "./public-handle";

test("public handles accept names or nicknames and can be cleared", () => {
  assert.equal(readPublicHandle("  Dara Ó Briain  "), "Dara Ó Briain");
  assert.equal(readPublicHandle("@river-reader"), "@river-reader");
  assert.equal(readPublicHandle("   "), null);
  assert.equal(readPublicHandle("x".repeat(50)), "x".repeat(50));
  for (const value of [null, 123, {}, "x".repeat(51), "two\nlines", "hidden\u202ename"]) {
    assert.throws(() => readPublicHandle(value));
  }
});
