#!/usr/bin/env node
/**
 * Runs the Prisma CLI against whichever target is live, so nobody has to remember which
 * `--schema` flag pairs with which `DATABASE_URL`.
 *
 *   DB_TARGET=local pnpm --filter @oneresi/db migrate:dev
 *   DB_TARGET=cloud pnpm --filter @oneresi/db migrate
 *
 * Resolves the CLI through the module graph rather than PATH, so it works whether it is invoked
 * by a pnpm script or by `node scripts/prisma.mjs` directly.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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

const { target, databaseUrl, schemaPath } = databaseEnv();
process.stdout.write(`  prisma ${args.join(' ')}  ->  ${target.name} (${target.label})\n`);

const result = spawnSync(process.execPath, [prismaEntry(), ...args, '--schema', schemaPath], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

if (result.error !== undefined) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
