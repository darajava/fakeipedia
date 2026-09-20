import assert from "node:assert/strict";
import test from "node:test";
import { GraphMotion } from "./graph-motion";

function motion(reduced = false) {
  return new GraphMotion({ index: 0, x: 0, y: 0 }, [{ index: 1, x: 100, y: 20 }], 0, 1, reduced);
}
function pull(model: GraphMotion) {
  for (let frame = 1; frame <= 12; frame++) {
    model.move(frame * 12, frame * -4, frame * 16);
    model.step(16, 1);
  }
}

test("drag has spring resistance, then continues in the release direction and slows", () => {
  const model = motion();
  pull(model);
  const body = model.bodies[0];
  assert.ok(body.x > 0 && body.x < 144, "node follows with resistance instead of snapping to the cursor");
  const x = body.x, y = body.y;
  model.release(193);
  const speed = Math.hypot(body.vx, body.vy);
  model.step(32, 1);
  assert.ok(body.x > x && body.y < y);
  assert.ok(Math.hypot(body.vx, body.vy) < speed);
  let active = true;
  for (let frame = 0; frame < 600 && active; frame++) active = model.step(16, 1);
  assert.equal(active, false, "motion stops scheduling frames once it settles");
});

test("connected neighbours follow subtly instead of moving with the full drag", () => {
  const model = motion();
  pull(model);
  model.release(193);
  for (let frame = 0; frame < 300; frame++) model.step(16, 1);
  const [source, neighbour] = model.bodies;
  assert.ok(neighbour.x > 100 && neighbour.y < 20);
  assert.ok(neighbour.x - 100 < source.x * 0.2);
  assert.ok(Math.abs(neighbour.x - 100 - source.x * 0.12) < 0.2);
});

test("pausing before release and pointer cancellation do not fling", () => {
  for (const cancelled of [false, true]) {
    const model = motion();
    pull(model);
    if (!cancelled) for (let i = 0; i < 30; i++) model.step(16, 1);
    model.release(cancelled ? 193 : 700, cancelled);
    const { x, y } = model.bodies[0];
    model.step(32, 1);
    assert.equal(model.bodies[0].x, x);
    assert.equal(model.bodies[0].y, y);
  }
});

test("inertial motion is consistent at 60Hz and 120Hz", () => {
  const a = motion(), b = motion();
  pull(a); pull(b); a.release(193); b.release(193);
  for (let frame = 0; frame < 60; frame++) a.step(1000 / 60, 1);
  for (let frame = 0; frame < 120; frame++) b.step(1000 / 120, 1);
  assert.ok(Math.abs(a.bodies[0].x - b.bodies[0].x) < 0.001);
  assert.ok(Math.abs(a.bodies[1].x - b.bodies[1].x) < 0.001);
});

test("motion has a bounded neighbourhood and respects reduced motion", () => {
  const model = new GraphMotion({ index: 0, x: 0, y: 0 }, Array.from({ length: 1000 }, (_, i) => ({ index: i + 1, x: i, y: 0 })), 0, 1);
  assert.equal(model.bodies.length, 49);
  const reduced = motion(true);
  reduced.move(120, 40, 16); reduced.step(16, 1);
  assert.equal(reduced.bodies[0].x, 120);
  reduced.release(17);
  assert.equal(reduced.step(16, 1), false);
  assert.equal(reduced.bodies[0].x, 120);
});
