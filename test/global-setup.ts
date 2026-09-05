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

export async function setup(): Promise<void> {
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
