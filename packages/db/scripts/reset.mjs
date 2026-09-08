#!/usr/bin/env node
/**
 * Drops and recreates the live database: every table, the migrations history table, and the data
 * with it. `pnpm db:reset` then `pnpm db:seed` is the honest way to get back to a known state —
 * no half-converged rows, no orphaned outbox events from a run that was interrupted.
 *
 * Destructive on purpose, so it refuses to run without `--force`-equivalent intent: Prisma's own
 * `migrate reset` prompts interactively, which a script cannot answer, so `--force` is passed
 * here explicitly and the target is printed before anything is dropped. Against the cloud target
 * this wipes RDS just as thoroughly as it wipes the local file — the same one-target rule as
 * every other script in this package (see target.mjs).
 *
 * Re-runs the migrations afterwards (the schema survives), and nothing else: this package
 * declares no `prisma.seed` hook, so seeding stays an explicit second command rather than a
 * side effect of resetting.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const result = spawnSync(
  process.execPath,
  [join(here, 'prisma.mjs'), 'migrate', 'reset', '--force'],
  { stdio: 'inherit' },
);

if (result.error !== undefined) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
