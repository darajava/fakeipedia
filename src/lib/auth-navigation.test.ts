import test from "node:test";
import assert from "node:assert/strict";
import { authPagePath, authReturnPath, signupCompletionPath } from "./auth-navigation";

test("authentication retains the saved article destination when switching forms", () => {
  const destination = "/payment?intent=example";
  for (const mode of ["sign-up", "sign-in"] as const) {
    const url = new URL(authPagePath(mode, destination), "https://fakeipedia.org");
    assert.equal(url.pathname, `/auth/${mode}`);
    assert.equal(authReturnPath(url.searchParams.get("return")!, url.origin), destination);
  }
  assert.equal(authReturnPath(undefined), "/account");
  assert.equal(authReturnPath("https://fakeipedia.org/account", "https://fakeipedia.org"), "/account");
  const completion = new URL(signupCompletionPath(destination), "https://fakeipedia.org");
  assert.equal(completion.pathname, "/auth/complete");
  assert.equal(authReturnPath(completion.searchParams.get("return")!, completion.origin), destination);
});

test("authentication rejects external and unrelated return destinations", () => {
  for (const path of ["https://example.com/payment", "//example.com/account", "javascript:alert(1)", "/api/billing/checkout", "/auth/sign-up", "/%2fexample.com/account", "https://fakeipedia.org.evil.test/account", "/\\example.com/account"]) {
    assert.equal(authReturnPath(path, "https://fakeipedia.org"), null, path);
  }
});
