export type MotionPoint = { index: number; x: number; y: number };
type Body = MotionPoint & { originX: number; originY: number; vx: number; vy: number };

/** A bounded, local spring system; dragging never re-simulates the whole wiki. */
export class GraphMotion {
  readonly bodies: Body[];
  held = true;
  private targetX: number;
  private targetY: number;
  private pointerVX = 0;
  private pointerVY = 0;
  private lastMove: number;

  constructor(source: MotionPoint, neighbours: MotionPoint[], now: number, private scale: number, private reducedMotion = false) {
    this.bodies = [source, ...neighbours.slice(0, 48)].map((point) => ({ ...point, originX: point.x, originY: point.y, vx: 0, vy: 0 }));
    this.targetX = source.x;
    this.targetY = source.y;
    this.lastMove = now;
  }

  move(x: number, y: number, now: number) {
    const elapsed = Math.max(8, now - this.lastMove) / 1000;
    if (x === this.targetX && y === this.targetY) return;
    const weight = 1 - Math.exp(-elapsed / 0.035);
    this.pointerVX += ((x - this.targetX) / elapsed - this.pointerVX) * weight;
    this.pointerVY += ((y - this.targetY) / elapsed - this.pointerVY) * weight;
    this.targetX = x; this.targetY = y; this.lastMove = now;
  }

  release(now: number, cancelled = false) {
    this.held = false;
    const body = this.bodies[0];
    // Holding still before letting go should not produce a delayed fling.
    const fling = !cancelled && !this.reducedMotion && now - this.lastMove < 100;
    body.vx = fling ? 0.65 * this.pointerVX + 0.35 * body.vx : 0;
    body.vy = fling ? 0.65 * this.pointerVY + 0.35 * body.vy : 0;
    this.limitVelocity(body);
  }

  private limitVelocity(body: Body) {
    const speed = Math.hypot(body.vx, body.vy);
    const limit = 1200 / this.scale;
    if (speed > limit) { body.vx *= limit / speed; body.vy *= limit / speed; }
  }

  step(milliseconds: number, scale: number): boolean {
    this.scale = Math.max(0.002, scale);
    const source = this.bodies[0];
    if (this.reducedMotion) {
      if (this.held) { source.x = this.targetX; source.y = this.targetY; }
      for (const body of this.bodies.slice(1)) {
        body.x = body.originX + (source.x - source.originX) * 0.12;
        body.y = body.originY + (source.y - source.originY) * 0.12;
      }
      return this.held;
    }
    // Fixed-size substeps keep the feel consistent at 60/120Hz and after stalls.
    const duration = Math.max(0, Math.min(64, milliseconds)) / 1000;
    const steps = Math.max(1, Math.ceil(duration * 120));
    const dt = duration / steps;
    for (let step = 0; step < steps; step++) {
      if (this.held) {
        const resistance = this.bodies.length > 1 ? 0.8 : 0;
        source.vx += ((this.targetX - source.x) * 180 - source.vx * 24 - (source.x - source.originX) * resistance) * dt;
        source.vy += ((this.targetY - source.y) * 180 - source.vy * 24 - (source.y - source.originY) * resistance) * dt;
      } else {
        source.vx *= Math.exp(-4.5 * dt);
        source.vy *= Math.exp(-4.5 * dt);
      }
      this.limitVelocity(source);
      source.x += source.vx * dt; source.y += source.vy * dt;
      for (let i = 1; i < this.bodies.length; i++) {
        const body = this.bodies[i];
        const x = body.originX + (source.x - source.originX) * 0.12;
        const y = body.originY + (source.y - source.originY) * 0.12;
        body.vx += ((x - body.x) * 28 - body.vx * 10) * dt;
        body.vy += ((y - body.y) * 28 - body.vy * 10) * dt;
        body.x += body.vx * dt; body.y += body.vy * dt;
      }
    }
    return this.held || this.bodies.some((body, index) => {
      const error = index ? Math.hypot(body.originX + (source.x - source.originX) * 0.12 - body.x, body.originY + (source.y - source.originY) * 0.12 - body.y) : 0;
      return Math.hypot(body.vx, body.vy) * this.scale > 0.5 || error * this.scale > 0.1;
    });
  }
}
