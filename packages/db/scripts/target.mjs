/**
 * Which database is live, and how to reach it.
 *
 * One target is chosen at boot. Never two, never automatic failover — two writable copies that
 * silently swap produce divergence that cannot be merged afterwards. See
 * docs/plan/02-architecture.md.
 *
 * Mirrored in src/env.ts for the TypeScript side; a unit test asserts the two agree.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(here, '..');
export const repoRoot = resolve(packageRoot, '..', '..');

export const TARGETS = {
  local: { provider: 'sqlite', label: 'local file' },
  cloud: { provider: 'postgresql', label: 'RDS' },
};

export function resolveTarget(env = process.env) {
  const requested = env.DB_TARGET ?? 'local';
  const target = TARGETS[requested];
  if (target === undefined) {
    throw new Error(
      `DB_TARGET must be one of ${Object.keys(TARGETS).join(' | ')}, received "${requested}"`,
    );
  }
  return { name: requested, ...target };
}

/** Default location of the local database file. Kept outside the package so a clean is one rm. */
export function localDatabaseFile(env = process.env) {
  return env.LOCAL_DB_FILE ?? join(repoRoot, '.data', 'grihaone.db');
}

/**
 * The connection string for the live target.
 *
 * Local needs nothing configured — that is the point. Cloud must be configured explicitly and
 * fails loudly if it is not, rather than quietly serving local data (D-06).
 */
export function resolveDatabaseUrl(env = process.env) {
  const target = resolveTarget(env);

  if (target.name === 'local') {
    const file = localDatabaseFile(env);
    mkdirSync(dirname(file), { recursive: true });
    // Prisma wants a URL; on Windows the drive letter needs forward slashes.
    return `file:${file.replaceAll('\\', '/')}`;
  }

  const url = env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'DB_TARGET=cloud but DATABASE_URL is not set. It comes from Secrets Manager on AWS, or from ' +
        '`pnpm cloud:env` locally. Refusing to fall back to the local database.',
    );
  }
  if (!url.startsWith('postgres')) {
    throw new Error(`DB_TARGET=cloud expects a PostgreSQL URL, received "${url.slice(0, 12)}..."`);
  }
  if (!url.includes('sslmode=')) {
    throw new Error('The cloud DATABASE_URL must specify sslmode=require.');
  }
  return url;
}

export function schemaPathFor(provider) {
  return join(packageRoot, 'prisma', provider, 'schema.prisma');
}

/** Everything the Prisma CLI and the client need, derived from one variable. */
export function databaseEnv(env = process.env) {
  const target = resolveTarget(env);
  return {
    target,
    databaseUrl: resolveDatabaseUrl(env),
    schemaPath: schemaPathFor(target.provider),
    migrationsDir: join(packageRoot, 'prisma', target.provider, 'migrations'),
  };
}
