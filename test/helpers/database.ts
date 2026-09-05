import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll } from 'vitest';
import type { Db } from '@oneresi/db';

/**
 * An isolated database per test file.
 *
 * SQLite gets a copy of the migrated template, which is instant. PostgreSQL gets its own schema in
 * the shared instance. Same interface either way, so a test never knows which engine it is on —
 * that is the point of the parity suite.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');
const TEMPLATE_SQLITE = join(repoRoot, '.data', 'test', 'template.db');

export interface TestDb {
  readonly db: Db;
  readonly provider: 'sqlite' | 'postgresql';
}

export async function testDatabase(): Promise<TestDb> {
  const target = process.env.DB_TARGET ?? 'local';
  const suffix = randomBytes(6).toString('hex');

  if (target === 'local') {
    const dir = join(repoRoot, '.data', 'test', 'runs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${suffix}.db`);
    copyFileSync(TEMPLATE_SQLITE, file);

    const { PrismaClient } = await import('@oneresi/db/generated/sqlite');
    const db = new PrismaClient({
      datasourceUrl: `file:${file.replaceAll('\\', '/')}`,
    }) as unknown as Db;

    afterAll(async () => {
      await db.$disconnect();
      rmSync(file, { force: true });
      rmSync(`${file}-journal`, { force: true });
    });

    return { db, provider: 'sqlite' };
  }

  const base = process.env.DATABASE_URL;
  if (base === undefined) throw new Error('DB_TARGET=cloud needs DATABASE_URL');

  const schema = `oneresi_test_${suffix}`;
  const url = new URL(base);
  url.searchParams.set('schema', schema);

  // Each file gets its own schema, so it needs its own migration run. Slower than the SQLite copy,
  // and only paid in CI where a PostgreSQL instance exists.
  execFileSync(
    process.execPath,
    [join(repoRoot, 'packages', 'db', 'scripts', 'prisma.mjs'), 'migrate', 'deploy'],
    {
      cwd: join(repoRoot, 'packages', 'db'),
      env: { ...process.env, DB_TARGET: 'cloud', DATABASE_URL: url.toString() },
      stdio: 'inherit',
    },
  );

  const { PrismaClient } = await import('@oneresi/db/generated/postgresql');
  const db = new PrismaClient({ datasourceUrl: url.toString() });

  afterAll(async () => {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  });

  return { db, provider: 'postgresql' };
}
