import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { generateArticleText } from "./article-text";

function textChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function streamResponse(events: object[]) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function streamedClient(events: object[]) {
  return new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async () => streamResponse(events),
  });
}

async function collectText(client?: OpenAI) {
  const chunks: string[] = [];
  for await (const chunk of generateArticleText("Write an article about Zorg.", client)) {
    chunks.push(chunk);
  }
  return chunks;
}

test("streams article text from Gemini with medium reasoning without exposing reasoning", async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  t.after(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  let requestBody: unknown;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-gemini-key");
    requestBody = JSON.parse(String(init?.body));
    return streamResponse([
      textChunk({ role: "assistant" }),
      textChunk({ reasoning_content: "Private reasoning" }),
      textChunk({ content: "# Zorg\n\n" }),
      textChunk({ content: "" }),
      { choices: [] },
      textChunk({ content: "A world of canals." }, "stop"),
    ]);
  });

  assert.deepEqual(await collectText(), ["# Zorg\n\n", "A world of canals."]);
  assert.deepEqual(requestBody, {
    model: "gemini-4-argon",
    messages: [{ role: "user", content: "Write an article about Zorg." }],
    reasoning_effort: "medium",
    stream: true,
  });
});

for (const scenario of [
  {
    name: "incomplete generation",
    events: [textChunk({}, "length")],
    error: /incomplete: length/,
  },
  {
    name: "unexpected tool call",
    events: [textChunk({}, "tool_calls")],
    error: /incomplete: tool_calls/,
  },
  {
    name: "stream without a completion event",
    events: [],
    error: /ended before completion/,
  },
  {
    name: "refused generation",
    events: [textChunk({ refusal: "Cannot comply" })],
    error: /declined to generate/,
  },
  {
    name: "filtered generation",
    events: [textChunk({}, "content_filter")],
    error: /declined to generate/,
  },
  {
    name: "stream error",
    events: [{ error: { message: "Stream failed upstream", code: "server_error" } }],
    error: /Stream failed upstream/,
  },
]) {
  test(`rejects partial article text after ${scenario.name}`, async () => {
    const client = streamedClient([
      textChunk({ content: "# Partial article" }),
      ...scenario.events,
    ]);

    await assert.rejects(collectText(client), scenario.error);
  });
}

test("propagates request failures to the article stream error handler", async () => {
  const client = new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async () => new Response(JSON.stringify({
      error: { message: "Model access denied", type: "invalid_request_error", code: "model_not_found" },
    }), { status: 404, headers: { "Content-Type": "application/json" } }),
  });

  await assert.rejects(collectText(client), /Model access denied/);
});

test("requires a Gemini key instead of falling back to the OpenAI key", async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(() => {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("A request should not be sent without a Gemini key.");
  });

  await assert.rejects(collectText(), /Set GEMINI_API_KEY/);
  assert.equal(fetchMock.mock.callCount(), 0);
});
