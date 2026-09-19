import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Which database is live. One target, chosen at boot, never automatic failover — see
 * docs/plan/02-architecture.md for why two writable copies with silent failover is a trap.
 *
 * Mirrors scripts/target.mjs, which the Prisma CLI wrapper needs and cannot import from
 * TypeScript. A unit test asserts the two agree for the same environment.
 */

export const TARGETS = {
  local: { provider: 'sqlite', label: 'local file' },
  cloud: { provider: 'postgresql', label: 'RDS' },
} as const;

export type TargetName = keyof typeof TARGETS;
export type Provider = (typeof TARGETS)[TargetName]['provider'];

export interface Target {
  readonly name: TargetName;
  readonly provider: Provider;
  readonly label: string;
}

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '..', '..');

function isTargetName(value: string): value is TargetName {
  return Object.hasOwn(TARGETS, value);
}

export function resolveTarget(env: NodeJS.ProcessEnv = process.env): Target {
  const requested = env.DB_TARGET ?? 'local';
  if (!isTargetName(requested)) {
    throw new Error(
      `DB_TARGET must be one of ${Object.keys(TARGETS).join(' | ')}, received "${requested}"`,
    );
  }
  return { name: requested, ...TARGETS[requested] };
}

export function localDatabaseFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCAL_DB_FILE ?? join(repoRoot, '.data', 'grihaone.db');
}

/**
 * Local needs no configuration — that is the point of the local target.
 *
 * Cloud must be configured explicitly and fails loudly when it is not. The previous build did the
 * opposite: an unset variable silently selected an in-memory store, so a deployment would have
 * ignored the RDS instance provisioned for it (D-06).
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const target = resolveTarget(env);

  if (target.name === 'local') {
    const file = localDatabaseFile(env);
    mkdirSync(dirname(file), { recursive: true });
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

/**
 * Refuses to start in production without the things production needs. Boot-time failure is the
 * point: the previous build fell back to a committed JWT secret when the variable was absent, so
 * anyone could mint an admin session on the deployed app (D-05).
 */
export function assertRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  if (resolveTarget(env).name !== 'cloud') {
    problems.push('DB_TARGET must be "cloud" in production');
  }
  const secret = env.JWT_SECRET ?? '';
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    problems.push('JWT_SECRET must be set and at least 32 bytes; there is no fallback');
  }
  if (env.APP_ORIGIN === undefined || !env.APP_ORIGIN.startsWith('https://')) {
    problems.push('APP_ORIGIN must be an https origin — the session cookie is Secure');
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n  - ${problems.join('\n  - ')}`);
  }
}
