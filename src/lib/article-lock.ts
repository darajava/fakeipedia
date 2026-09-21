import { Pool } from "pg";

// Keep lock sessions separate so queued model requests cannot exhaust the
// application query pool while waiting for their own database operations.
export const articleLockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });

export class ArticleBusyError extends Error {
  constructor() { super("This article is being prepared by another request. Please try again shortly."); }
}

// Session locks survive across the model call, work across server processes,
// and are released by PostgreSQL if the connection/process dies.
export async function acquireArticleLock(key: string) {
  const client = await articleLockPool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key],
    );
    if (!result.rows[0].locked) throw new ArticleBusyError();
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      client.release();
    } catch {
      // Never return a potentially locked session to the pool.
      client.release(true);
    }
  };
}
