import { getDb, closeDb } from '@grihaone/db';

/**
 * The load balancer's question, answered from the server module where db access belongs: one
 * `SELECT 1` against the live target, because a deployment whose app serves but cannot reach its
 * database is exactly as broken as one that does not serve — and that distinction is what the
 * health check exists to make. Route handlers never touch @grihaone/db (WIRING rule 4); this
 * file is the server seam that does.
 */
export async function databaseReachable(): Promise<boolean> {
  try {
    const db = await getDb();
    try {
      await db.$queryRaw`SELECT 1`;
    } finally {
      await closeDb().catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}
