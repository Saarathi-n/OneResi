import { getDb } from '@grihaone/db';

/**
 * The load balancer's question, answered from the server module where db access belongs: one
 * `SELECT 1` against the live target, because a deployment whose app serves but cannot reach its
 * database is exactly as broken as one that does not serve — and that distinction is what the
 * health check exists to make. Route handlers never touch @grihaone/db (WIRING rule 4); this
 * file is the server seam that does.
 *
 * The probe deliberately does NOT close the client: `getDb()` returns the process's one shared
 * pool (the same one every service uses), and closing it here would take the application's
 * database down every thirty seconds. Lifecycle belongs to the process — SIGTERM closes it.
 */
export async function databaseReachable(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
