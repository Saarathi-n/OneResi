#!/usr/bin/env node
/**
 * Runs the Prisma CLI against whichever target is live, so nobody has to remember which
 * `--schema` flag pairs with which `DATABASE_URL`.
 *
 *   DB_TARGET=local pnpm --filter @oneresi/db migrate:dev
 *   DB_TARGET=cloud pnpm --filter @oneresi/db migrate
 *
 * `generate` is the exception: client generation needs no database at all, so it generates BOTH
 * clients (SQLite and PostgreSQL) regardless of the live target — the root `pnpm db:generate`
 * promises exactly that, and an image built with only one client fails its app build on the
 * other (apps/web imports the PostgreSQL client for types even when SQLite is the live target).
 *
 * Resolves the CLI through the module graph rather than PATH, so it works whether it is invoked
 * by a pnpm script or by `node scripts/prisma.mjs` directly.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseEnv } from './target.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('usage: node scripts/prisma.mjs <prisma args...>\n');
  process.exit(2);
}

function prismaEntry() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('prisma/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.prisma;
  if (bin === undefined) throw new Error('Cannot locate the prisma CLI entry point');
  return join(dirname(manifestPath), bin);
}

function run(prismaArgs, schemaPath, env = process.env) {
  const result = spawnSync(process.execPath, [prismaEntry(), ...prismaArgs, '--schema', schemaPath], {
    stdio: 'inherit',
    env: { ...env },
  });
  if (result.error !== undefined) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  return result.status ?? 1;
}

// Client generation: both schemas, no database needed, no target chosen.
if (args[0] === 'generate') {
  const schemaOf = (variant) =>
    fileURLToPath(new URL(`../prisma/${variant}/schema.prisma`, import.meta.url));
  process.stdout.write('  prisma generate  -> both clients (sqlite + postgresql)\n');
  const rest = args.slice(1);
  const statuses = [
    run(['generate', ...rest], schemaOf('sqlite')),
    run(['generate', ...rest], schemaOf('postgresql')),
  ];
  process.exit(statuses.every((status) => status === 0) ? 0 : 1);
}

const { target, databaseUrl, schemaPath } = databaseEnv();
process.stdout.write(`  prisma ${args.join(' ')}  ->  ${target.name} (${target.label})\n`);

const status = run(args, schemaPath, { ...process.env, DATABASE_URL: databaseUrl });
process.exit(status);
