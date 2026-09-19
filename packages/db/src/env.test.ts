import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TARGETS,
  assertRuntimeConfig,
  localDatabaseFile,
  resolveDatabaseUrl,
  resolveTarget,
} from './env.js';

/**
 * One target, chosen at boot, and it fails loudly when it is not configured.
 *
 * The previous build did the opposite: an unset variable silently selected an in-memory store, so a
 * deployment would have ignored the RDS instance provisioned for it (D-06), and an absent
 * JWT_SECRET fell back to a committed constant so anyone could mint an admin session (D-05).
 *
 * The second half of this file exists because env.ts and scripts/target.mjs are deliberate
 * mirrors — the Prisma CLI wrapper cannot import TypeScript — and a mirror that drifts is worse
 * than no mirror at all.
 */

const packageRoot = resolve(import.meta.dirname, '..');

interface TargetMirror {
  readonly TARGETS: Record<string, { provider: string; label: string }>;
  resolveTarget(env: NodeJS.ProcessEnv): { name: string; provider: string; label: string };
  localDatabaseFile(env: NodeJS.ProcessEnv): string;
  resolveDatabaseUrl(env: NodeJS.ProcessEnv): string;
  schemaPathFor(provider: string): string;
  databaseEnv(env: NodeJS.ProcessEnv): unknown;
}

// A computed specifier: this is JavaScript the Prisma CLI wrapper loads directly, so there is no
// declaration file to import from and nothing to gain from pretending there is.
const mirror = (await import(
  pathToFileURL(join(packageRoot, 'scripts', 'target.mjs')).href
)) as TargetMirror;

const scratch = mkdtempSync(join(tmpdir(), 'grihaone-env-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Whatever the call produced: a value, or the message it refused with. */
function outcome(run: () => string): { value: string } | { error: string } {
  try {
    return { value: run() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

describe('resolveTarget', () => {
  it('defaults to local, because local needs no configuration', () => {
    expect(resolveTarget({})).toEqual({ name: 'local', provider: 'sqlite', label: 'local file' });
  });

  it('names the two targets and nothing else', () => {
    expect(Object.keys(TARGETS)).toEqual(['local', 'cloud']);
    expect(resolveTarget({ DB_TARGET: 'cloud' }).provider).toBe('postgresql');
  });

  it('refuses a target it does not have', () => {
    expect(() => resolveTarget({ DB_TARGET: 'mock' })).toThrow(/DB_TARGET must be one of/);
    expect(() => resolveTarget({ DB_TARGET: 'staging' })).toThrow(/received "staging"/);
  });
});

describe('resolveDatabaseUrl for the local target', () => {
  it('returns a file URL with nothing configured at all', () => {
    const url = resolveDatabaseUrl({});
    expect(url.startsWith('file:')).toBe(true);
    expect(url.endsWith('/.data/grihaone.db')).toBe(true);
    // Prisma wants forward slashes even on Windows.
    expect(url).not.toContain('\\');
  });

  it('creates the directory it points at, so a fresh clone has nothing to prepare', () => {
    const file = join(scratch, 'nested', 'deeper', 'grihaone.db');
    expect(existsSync(join(scratch, 'nested'))).toBe(false);

    const url = resolveDatabaseUrl({ LOCAL_DB_FILE: file });

    expect(existsSync(join(scratch, 'nested', 'deeper'))).toBe(true);
    expect(url).toBe(`file:${file.replaceAll('\\', '/')}`);
  });

  it('honours LOCAL_DB_FILE so a test run cannot touch the development database', () => {
    expect(localDatabaseFile({ LOCAL_DB_FILE: '/tmp/somewhere.db' })).toBe('/tmp/somewhere.db');
    expect(localDatabaseFile({})).toMatch(/[\\/]\.data[\\/]grihaone\.db$/);
  });
});

describe('resolveDatabaseUrl for the cloud target', () => {
  it('refuses to fall back to the local database when DATABASE_URL is absent', () => {
    expect(() => resolveDatabaseUrl({ DB_TARGET: 'cloud' })).toThrow(/DATABASE_URL is not set/);
    expect(() => resolveDatabaseUrl({ DB_TARGET: 'cloud' })).toThrow(/Refusing to fall back/);
    expect(() => resolveDatabaseUrl({ DB_TARGET: 'cloud', DATABASE_URL: '' })).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it('refuses a URL that is not PostgreSQL', () => {
    expect(() =>
      resolveDatabaseUrl({ DB_TARGET: 'cloud', DATABASE_URL: 'file:./cloud.db' }),
    ).toThrow(/expects a PostgreSQL URL/);
  });

  it('refuses a URL that does not state its TLS mode', () => {
    expect(() =>
      resolveDatabaseUrl({
        DB_TARGET: 'cloud',
        DATABASE_URL: 'postgresql://user:pass@db.internal:5432/grihaone',
      }),
    ).toThrow(/sslmode=require/);
  });

  it('accepts a URL that states it', () => {
    const url = 'postgresql://user:pass@db.internal:5432/grihaone?sslmode=require';
    expect(resolveDatabaseUrl({ DB_TARGET: 'cloud', DATABASE_URL: url })).toBe(url);
  });
});

describe('assertRuntimeConfig', () => {
  const production = {
    NODE_ENV: 'production',
    DB_TARGET: 'cloud',
    DATABASE_URL: 'postgresql://user:pass@db.internal:5432/grihaone?sslmode=require',
    APP_ORIGIN: 'https://grihaone.example',
    JWT_SECRET: 'x'.repeat(32),
  } satisfies NodeJS.ProcessEnv;

  it('says nothing outside production', () => {
    expect(() => assertRuntimeConfig({})).not.toThrow();
    expect(() => assertRuntimeConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('accepts a fully configured production environment', () => {
    expect(() => assertRuntimeConfig(production)).not.toThrow();
  });

  it('refuses to start in production without JWT_SECRET', () => {
    const { JWT_SECRET: _omitted, ...withoutSecret } = production;
    expect(() => assertRuntimeConfig(withoutSecret)).toThrow(/JWT_SECRET/);
    expect(() => assertRuntimeConfig(withoutSecret)).toThrow(/there is no fallback/);
  });

  it('refuses a JWT_SECRET short enough to be guessed', () => {
    expect(() => assertRuntimeConfig({ ...production, JWT_SECRET: 'short' })).toThrow(
      /at least 32 bytes/,
    );
  });

  it('refuses production on the local target, and an origin the cookie cannot be Secure on', () => {
    expect(() => assertRuntimeConfig({ ...production, DB_TARGET: 'local' })).toThrow(
      /DB_TARGET must be "cloud" in production/,
    );
    expect(() =>
      assertRuntimeConfig({ ...production, APP_ORIGIN: 'http://grihaone.example' }),
    ).toThrow(/APP_ORIGIN must be an https origin/);
  });
});

describe('src/env.ts and scripts/target.mjs', () => {
  const cases: readonly { readonly why: string; readonly env: NodeJS.ProcessEnv }[] = [
    { why: 'nothing configured', env: {} },
    { why: 'local, explicit', env: { DB_TARGET: 'local' } },
    { why: 'local, relocated', env: { DB_TARGET: 'local', LOCAL_DB_FILE: join(scratch, 'm.db') } },
    { why: 'an unknown target', env: { DB_TARGET: 'mock' } },
    { why: 'cloud, unconfigured', env: { DB_TARGET: 'cloud' } },
    { why: 'cloud, empty URL', env: { DB_TARGET: 'cloud', DATABASE_URL: '' } },
    { why: 'cloud, wrong engine', env: { DB_TARGET: 'cloud', DATABASE_URL: 'file:./x.db' } },
    {
      why: 'cloud, no TLS mode',
      env: { DB_TARGET: 'cloud', DATABASE_URL: 'postgresql://u:p@h:5432/d' },
    },
    {
      why: 'cloud, configured',
      env: { DB_TARGET: 'cloud', DATABASE_URL: 'postgresql://u:p@h:5432/d?sslmode=require' },
    },
  ];

  it('describe the same two targets', () => {
    expect(mirror.TARGETS).toEqual(TARGETS);
  });

  it('export the same mirrored surface', () => {
    for (const name of ['resolveTarget', 'localDatabaseFile', 'resolveDatabaseUrl'] as const) {
      expect(typeof mirror[name], `target.mjs is missing ${name}`).toBe('function');
    }
  });

  it.each(cases)('agree for $why', ({ env }) => {
    expect(outcome(() => JSON.stringify(mirror.resolveTarget(env)))).toEqual(
      outcome(() => JSON.stringify(resolveTarget(env))),
    );
    expect(outcome(() => mirror.localDatabaseFile(env))).toEqual(
      outcome(() => localDatabaseFile(env)),
    );
    expect(outcome(() => mirror.resolveDatabaseUrl(env))).toEqual(
      outcome(() => resolveDatabaseUrl(env)),
    );
  });
});
