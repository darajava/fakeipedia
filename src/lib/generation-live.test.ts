import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveMessage, generationDeltaPackets, type GenerationSnapshot } from "./generation-live";
import { emptyGenerationProgress } from "./generation-progress";

const snapshot = (markdown: string, generationId = "attempt-1"): GenerationSnapshot => ({
  type: "snapshot", generationId, progress: { ...emptyGenerationProgress(), markdown }, status: "running", attempts: 1, funding: "credit", previewComplete: false,
});
test("live chunks appear between checkpoints without duplicate text or backwards jumps", () => {
  let state = applyLiveMessage({ generationId: null, progress: emptyGenerationProgress() }, snapshot("Hello"));
  state = applyLiveMessage(state, { type: "delta", generationId: "attempt-1", offset: 5, delta: " world" });
  assert.equal(state.progress.markdown, "Hello world");
  state = applyLiveMessage(state, snapshot("Hello"));
  assert.equal(state.progress.markdown, "Hello world");
  state = applyLiveMessage(state, { type: "delta", generationId: "attempt-1", offset: 5, delta: " world!" });
  assert.equal(state.progress.markdown, "Hello world!");
  state = applyLiveMessage(state, snapshot("Hello world!"));
  state = applyLiveMessage(state, { type: "delta", generationId: "attempt-1", offset: 5, delta: " world!" });
  assert.equal(state.progress.markdown, "Hello world!");
});
test("reconnects recover the tail since the checkpoint and retry attempts replace failed text", () => {
  let state = applyLiveMessage({ generationId: null, progress: emptyGenerationProgress() }, snapshot("Hello"));
  state = applyLiveMessage(state, { type: "delta", generationId: "attempt-1", offset: 5, delta: " world!" });
  assert.equal(state.progress.markdown, "Hello world!");
  state = applyLiveMessage(state, snapshot("New draft", "attempt-2"));
  state = applyLiveMessage(state, { type: "delta", generationId: "attempt-1", offset: 9, delta: "old text" });
  assert.equal(state.progress.markdown, "New draft");
  state = applyLiveMessage(state, { ...snapshot("Clean final draft", "attempt-2"), progress: { ...emptyGenerationProgress(), markdown: "Clean final draft", phase: "images" } });
  state = applyLiveMessage(state, { type: "delta", generationId: "attempt-2", offset: 0, delta: "New draft stale text" });
  assert.equal(state.progress.markdown, "Clean final draft");
});
test("large Unicode chunks fit notification limits without splitting characters or losing offsets", () => {
  const text = ('😀漢字\n"\\\u0000').repeat(3000);
  const packets = generationDeltaPackets("attempt-1", 7, text);
  assert.ok(packets.length > 1);
  let offset = 7;
  for (const packet of packets) {
    assert.ok(Buffer.byteLength(JSON.stringify(packet)) < 8000);
    assert.equal(packet.offset, offset);
    assert.ok(!/[\uD800-\uDBFF]$/.test(packet.delta));
    offset += packet.delta.length;
  }
  assert.equal(packets.map(p => p.delta).join(""), text);
});
