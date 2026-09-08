import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Builds a migrated template database once, before any test file runs. Each test file then takes
 * an isolated copy, so tests cannot see each other's rows and none of them pay for a migration.
 *
 * Runs for whichever target DB_TARGET names, which is how the same suite verifies both engines.
 */

const repoRoot = resolve(import.meta.dirname, '..');
const dbPackage = join(repoRoot, 'packages', 'db');

export const TEMPLATE_SQLITE = join(repoRoot, '.data', 'test', 'template.db');

function runScript(script: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  execFileSync(process.execPath, [join(dbPackage, 'scripts', script), ...args], {
    cwd: dbPackage,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

/** Synchronous on purpose: every step here is `execFileSync`, and vitest accepts either shape. */
export function setup(): void {
  const target = process.env.DB_TARGET ?? 'local';

  runScript('generate-schemas.mjs', [], {});

  if (target === 'local') {
    rmSync(dirname(TEMPLATE_SQLITE), { recursive: true, force: true });
    mkdirSync(dirname(TEMPLATE_SQLITE), { recursive: true });
    runScript('prisma.mjs', ['migrate', 'deploy'], {
      DB_TARGET: 'local',
      LOCAL_DB_FILE: TEMPLATE_SQLITE,
    });
    return;
  }

  if (process.env.DATABASE_URL === undefined) {
    throw new Error('DB_TARGET=cloud needs DATABASE_URL. `pnpm test:parity` skips it when absent.');
  }
  runScript('prisma.mjs', ['migrate', 'deploy'], { DB_TARGET: 'cloud' });
}

/**
 * The template and every per-file copy go when the run ends, so a green suite leaves the working
 * tree exactly as it found it. `test/helpers/database.ts` already deletes each copy as its file
 * finishes; this is the sweep for a run that was interrupted, and for the template itself.
 *
 * Retried, because a worker thread on Windows can still be closing the SQLite handle when the main
 * process gets here. If something is genuinely stuck it says so rather than failing a passing run —
 * and `setup()` clears the directory on the next run regardless.
 */
export async function teardown(): Promise<void> {
  if ((process.env.DB_TARGET ?? 'local') !== 'local') return;
  const dir = dirname(TEMPLATE_SQLITE);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  process.stdout.write(
    `  warning: could not remove ${dir}; it is rebuilt on the next run anyway\n`,
  );
}
