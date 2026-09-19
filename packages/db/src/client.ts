import type { PrismaClient as PostgresClient } from '../prisma/generated/postgresql/index.js';
import { resolveDatabaseUrl, resolveTarget, type Target } from './env.js';

/**
 * One client. One schema. No parallel implementation.
 *
 * The previous build had a 798-line hand-written object standing in for Prisma whenever a
 * variable was unset — which was the default — and the two had already diverged on enumeration
 * values, field names, fixtures and transaction semantics (D-15). Everything that "worked locally
 * and broke on Postgres" descended from that.
 *
 * Here there is one client type. Which engine backs it is decided by DB_TARGET at boot, and both
 * are the same Prisma client generated from the same base schema, so a query that works on one
 * works on the other. `pnpm test:parity` runs the whole integration suite against both to keep
 * that true.
 */

/** The two generated clients are structurally identical; PostgreSQL is the production one. */
export type Db = PostgresClient;

export { Prisma } from '../prisma/generated/postgresql/index.js';

async function construct(target: Target, url: string): Promise<Db> {
  const log: ('warn' | 'error')[] =
    process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'];

  if (target.provider === 'sqlite') {
    const { PrismaClient } = await import('../prisma/generated/sqlite/index.js');
    return new PrismaClient({ datasourceUrl: url, log }) as unknown as Db;
  }
  const { PrismaClient } = await import('../prisma/generated/postgresql/index.js');
  return new PrismaClient({ datasourceUrl: url, log });
}

interface Connection {
  readonly db: Db;
  readonly target: Target;
}

/**
 * Cached per process, and on `globalThis` outside production so a dev-server reload does not open
 * a new pool on every edit.
 */
const cacheKey = '__grihaone_db__';
const globalCache = globalThis as unknown as { [cacheKey]?: Promise<Connection> };

async function open(): Promise<Connection> {
  const target = resolveTarget();
  const url = resolveDatabaseUrl();
  const db = await construct(target, url);

  // Fail here rather than on the first query, so a misconfigured cloud target is a startup error
  // with a clear message instead of a 500 in the middle of a request.
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (cause) {
    await db.$disconnect().catch(() => undefined);
    throw new Error(
      `Cannot reach the ${target.name} database (${target.label}). Not falling back to another ` +
        `target — see docs/plan/02-architecture.md.`,
      { cause },
    );
  }

  return { db, target };
}

export function connection(): Promise<Connection> {
  const existing = globalCache[cacheKey];
  if (existing !== undefined) return existing;

  const opened = open();
  // Always cached, in every environment. The previous skip-in-production meant every `getDb()`
  // outside the app's own memoized runtime constructed a NEW Prisma pool that `closeDb()` could
  // not see (the cache it reads was never written): the load balancer's 30-second health probe
  // leaked a pool each time, and so did every Lambda invocation, until RDS answered "remaining
  // connection slots are reserved" — which is exactly what the second deploy cycle hit. The
  // dev-server reload concern the skip existed for is already handled: a reload resets module
  // state, and the next `getDb()` simply opens a fresh pool.
  globalCache[cacheKey] = opened;
  return opened;
}

export async function getDb(): Promise<Db> {
  return (await connection()).db;
}

/** Which database is live. Shown in the dev console and the committee footer outside production. */
export async function liveTarget(): Promise<Target> {
  return (await connection()).target;
}

export async function closeDb(): Promise<void> {
  const existing = globalCache[cacheKey];
  if (existing === undefined) return;
  delete globalCache[cacheKey];
  const { db } = await existing;
  await db.$disconnect();
}
