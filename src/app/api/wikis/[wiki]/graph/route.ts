import { Pool } from "pg";
import { graphArticleLinks } from "@/lib/wiki-graph";
import { validSlug } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounded connection and snapshot caches. Article bodies never reach the browser.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10_000 });
type CachedArticle = { revision: string; line: string };
const snapshots = new Map<string, { expires: number; chunks: Uint8Array[]; bytes: number; articles: Map<string, CachedArticle> }>();
const CACHE_BYTES = 128 * 1024 * 1024;
const encoder = new TextEncoder();

export async function GET(request: Request, { params }: { params: Promise<{ wiki: string }> }) {
  const { wiki } = await params;
  if (!validSlug(wiki)) return new Response("Invalid wiki", { status: 400 });
  const cached = snapshots.get(wiki);
  const headers = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (cached && cached.expires > Date.now()) {
    let index = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (index < cached.chunks.length) controller.enqueue(cached.chunks[index++]);
        else controller.close();
      },
    }), { headers });
  }
  if (cached) snapshots.delete(wiki);

  const client = await pool.connect();
  let released = false;
  let cancelled = false;
  let count = 0;
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  const articleCache = new Map<string, CachedArticle>();
  async function release() {
    if (released) return;
    released = true;
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
  try {
    // One consistent snapshot, including deletions/generation during a long load.
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    // xmin changes on every row update, including imports and direct edits.
    // Refreshes read only metadata; unchanged bodies are neither read nor parsed.
    await client.query("DECLARE wiki_graph NO SCROLL CURSOR FOR SELECT slug, title, xmin::text AS revision FROM articles WHERE wiki = $1 AND slug NOT LIKE 'stub-%' ORDER BY slug", [wiki]);
  } catch (error) {
    await release();
    throw error;
  }

  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        if (cancelled || request.signal.aborted) { await release(); controller.close(); return; }
        const result = await client.query<{ slug: string; title: string; revision: string }>("FETCH FORWARD 128 FROM wiki_graph");
        if (cancelled) { await release(); return; }
        if (result.rows.length) {
          const lines: string[] = [];
          const changed = result.rows.filter((row) => cached?.articles.get(row.slug)?.revision !== row.revision);
          const bodies = changed.length ? await client.query<{ slug: string; content: string }>(
            "SELECT slug, content FROM articles WHERE wiki = $1 AND slug = ANY($2::text[])", [wiki, changed.map((row) => row.slug)],
          ) : { rows: [] };
          const content = new Map(bodies.rows.map((row) => [row.slug, row.content]));
          for (let i = 0; i < result.rows.length; i++) {
            const row = result.rows[i];
            const previous = cached?.articles.get(row.slug);
            const entry = previous?.revision === row.revision ? previous : {
              revision: row.revision,
              line: JSON.stringify([row.slug, row.title, graphArticleLinks(content.get(row.slug)!, wiki).filter((slug) => !slug.startsWith("stub-"))]) + "\n",
            };
            lines.push(entry.line);
            // Include approximate JS string/map overhead in the cache budget.
            bytes += entry.line.length * 2 + row.slug.length * 2 + 160;
            if (bytes <= CACHE_BYTES) articleCache.set(row.slug, entry);
            // Yield between small parsing batches so other server requests can run.
            if (i % 8 === 7) await new Promise<void>((resolve) => setImmediate(resolve));
          }
          count += result.rows.length;
          const chunk = encoder.encode(lines.join(""));
          bytes += chunk.byteLength;
          if (bytes <= CACHE_BYTES) chunks.push(chunk);
          else { chunks.length = 0; articleCache.clear(); }
          if (!cancelled) controller.enqueue(chunk);
          else await release();
          return;
        }
        await release();
        if (cancelled) return;
        const end = encoder.encode(JSON.stringify({ complete: true, count }) + "\n");
        controller.enqueue(end);
        controller.close();
        if (bytes + end.byteLength <= CACHE_BYTES) {
          chunks.push(end);
          for (const [key, entry] of snapshots) if (entry.expires <= Date.now()) snapshots.delete(key);
          while (snapshots.size >= 4 || [...snapshots.values()].reduce((total, entry) => total + entry.bytes, bytes + end.byteLength) > CACHE_BYTES) {
            const oldest = snapshots.keys().next().value;
            if (!oldest) break;
            snapshots.delete(oldest);
          }
          snapshots.set(wiki, { expires: Date.now() + 60_000, chunks, bytes: bytes + end.byteLength, articles: articleCache });
        }
      } catch (error) {
        await release();
        if (!cancelled) controller.error(error);
      }
    },
    async cancel() { cancelled = true; await release(); },
  }), { headers });
}
