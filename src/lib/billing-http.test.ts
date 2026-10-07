import assert from "node:assert/strict";
import test from "node:test";
import { billingEndpoint, privateJson } from "./billing/http";

test("billing accepts the browser's host when Next.js uses an internal request URL", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "http://localhost:3000";
  try {
    for (const { url, host, origin, status } of [
      { url: "http://localhost:3000/api", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", status: 200 },
      { url: "http://localhost:3000/api", host: "192.168.1.20:3000", origin: "http://192.168.1.20:3000", status: 200 },
      { url: "https://localhost:8080/api", host: "fakeipedia.org", origin: "https://fakeipedia.org", status: 200 },
      { url: "https://localhost:8080/api", host: "www.fakeipedia.org", origin: "https://www.fakeipedia.org", status: 200 },
      { url: "http://localhost:3000/api", host: "127.0.0.1:3000", origin: "https://other.example", status: 403 },
      { url: "http://localhost:3000/api", host: "127.0.0.1:3000", origin: "http://127.0.0.1:3001", status: 403 },
      { url: "https://localhost:8080/api", host: "fakeipedia.org", origin: "http://fakeipedia.org", status: 403 },
      { url: "https://localhost:8080/api", host: "fakeipedia.org", origin: "https://fakeipedia.org.other.example", status: 403 },
      { url: "https://localhost:8080/api", host: "fakeipedia.org", origin: "null", status: 403 },
    ]) {
      let called = false;
      const response = await billingEndpoint(new Request(url, {
        method: "POST", headers: { host, origin },
      }), async () => {
        called = true;
        return privateJson({ ok: true });
      });
      assert.equal(response.status, status, `${origin} to ${host}`);
      assert.equal(called, status === 200);
      if (status === 200) assert.deepEqual(await response.json(), { result: { ok: true } });
    }

    process.env.APP_URL = "https://fakeipedia.org";
    const canonical = await billingEndpoint(new Request("http://localhost:8080/api", {
      method: "POST", headers: { host: "internal:8080", origin: "https://fakeipedia.org" },
    }), async () => privateJson({ ok: true }));
    assert.equal(canonical.status, 200);

    delete process.env.APP_URL;
    const direct = await billingEndpoint(new Request("http://localhost:3000/api", {
      method: "POST", headers: { origin: "http://localhost:3000" },
    }), async () => privateJson({ ok: true }));
    assert.equal(direct.status, 200);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
