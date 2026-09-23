import { Pool, type Notification } from "pg";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { generationJobs } from "../../db/schema";
import { generationPreviewComplete } from "../generation-progress";
import { generationDeltaPackets, type GenerationDelta, type GenerationLiveMessage } from "../generation-live";
import { requireUuid } from "./config";
import type { Job } from "./credits";

// Listening connections must not compete with queries that fund or save articles.
export const generationStreamPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });
const channelFor = (id: string) => `generation_${requireUuid(id).replaceAll("-", "")}`;
type Notice = GenerationDelta | { type: "changed" };

export async function notifyGeneration(job: Job, delta?: { offset: number; text: string }) {
  const packets: Notice[] = delta ? generationDeltaPackets(job.leaseToken!, delta.offset, delta.text) : [{ type: "changed" }];
  for (const packet of packets) {
    // An expired worker must not publish into a newer generation attempt.
    await db.execute(sql`SELECT pg_notify(${channelFor(job.id)}, ${JSON.stringify(packet)}) FROM ${generationJobs}
      WHERE ${generationJobs.id}=${job.id} AND ${generationJobs.leaseToken}=${job.leaseToken}
      AND ${generationJobs.status} IN ('running', 'succeeded')`);
  }
}

export async function generationStream(jobId: string, signal: AbortSignal) {
  const channel = channelFor(jobId);
  const listener = await generationStreamPool.connect();
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let ready = false;
  let generationId: string | null = null;
  let deliveredLength = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const pending: Notice[] = [];
  let work = Promise.resolve();
  let cleanup: Promise<void> | undefined;
  function close() {
    if (closed) return cleanup;
    closed = true;
    clearInterval(timer);
    signal.removeEventListener("abort", abort);
    listener.removeListener("notification", notification);
    try { controller?.close(); } catch { /* Already cancelled by the reader. */ }
    cleanup = listener.query(`UNLISTEN "${channel}"`).then(() => { listener.removeListener("error", abort); listener.release(); }, () => { listener.removeListener("error", abort); listener.release(true); });
    return cleanup;
  }
  function abort() { void close(); }
  function send(message: GenerationLiveMessage) {
    if (closed) return;
    // Reconnect a slow reader from a snapshot instead of retaining an unbounded queue.
    if ((controller.desiredSize ?? 0) < -1024) { void close(); return; }
    controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
  }
  async function snapshot() {
    if (closed) return;
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)).limit(1);
    if (!job) { await close(); return; }
    deliveredLength = generationId === job.leaseToken && job.progress?.phase === "writing"
      ? Math.max(deliveredLength, job.progress.markdown.length) : job.progress?.markdown.length ?? 0;
    generationId = job.leaseToken;
    const previewComplete = generationPreviewComplete(job);
    send({ type: "snapshot", generationId, progress: job.progress, status: job.status, funding: job.funding, attempts: job.attempts, previewComplete });
    if (previewComplete || ["failed", "superseded"].includes(job.status)) await close();
  }
  async function deliver(notice: Notice) {
    if (closed) return;
    if (notice.type === "changed") { await snapshot(); return; }
    if (notice.generationId !== generationId || notice.offset > deliveredLength) await snapshot();
    if (notice.generationId === generationId) {
      send(notice);
      deliveredLength = Math.max(deliveredLength, notice.offset + notice.delta.length);
    }
  }
  function enqueue(operation: () => Promise<void>) {
    work = work.then(operation).catch(() => { void close(); });
  }
  function notification(event: Notification) {
    if (closed || event.channel !== channel || !event.payload) return;
    try {
      const notice = JSON.parse(event.payload) as Notice;
      if (!ready) pending.push(notice);
      else enqueue(() => deliver(notice));
    } catch { /* Ignore malformed notifications; checkpoints remain authoritative. */ }
  }
  listener.on("notification", notification);
  listener.on("error", abort);
  try {
    // Subscribe before taking the checkpoint so no concurrent text is lost.
    await listener.query(`LISTEN "${channel}"`);
  } catch (error) { await close(); throw error; }
  return new ReadableStream<Uint8Array>({
    async start(output) {
      controller = output;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || closed) { await close(); try { output.close(); } catch {} return; }
      try {
        await snapshot();
        ready = true;
        for (const notice of pending) enqueue(() => deliver(notice));
        pending.length = 0;
        // Recovery and lifecycle updates only; model text is pushed immediately.
        if (!closed) timer = setInterval(() => enqueue(snapshot), 2000);
      } catch { await close(); }
    },
    async cancel() { await close(); },
  });
}
