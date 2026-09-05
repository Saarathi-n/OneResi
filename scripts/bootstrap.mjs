#!/usr/bin/env node
/**
 * One command from a fresh clone to a working local setup.
 *
 * Local development needs no configuration at all — no `.env`, no database server, no AWS account,
 * no credentials. That is a deliberate property: the previous build's local mode quietly swapped in
 * an in-memory store whenever a variable was unset (D-06), so "it works on my machine" meant
 * nothing. Here the local target is a real SQLite file with the real schema and the real migrations,
 * and this script is what puts it there.
 *
 *   pnpm bootstrap
 *
 * Idempotent. Run it after pulling a migration, after switching branches, or whenever the local
 * database looks wrong. Nothing here talks to the network except the Prisma engine download that
 * `pnpm install` already did.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const dbPackage = join(repoRoot, 'packages', 'db');
const require = createRequire(import.meta.url);
/** pnpm installs each package's own dependencies beside it, so prisma resolves from packages/db. */
const requireFromDb = createRequire(join(dbPackage, 'package.json'));

const MINIMUM_NODE = [20, 11];

/**
 * `prisma generate` needs a syntactically valid URL for the datasource it is generating for, and it
 * never connects. The PostgreSQL client has to exist even on a local-only machine because
 * packages/db/src/client.ts imports its types directly, so this placeholder stands in for a
 * connection string nobody has. It is not a fallback: nothing reads it at runtime.
 */
const CODEGEN_URL = 'postgresql://codegen:codegen@127.0.0.1:1/codegen?sslmode=require';

const out = (line = '') => process.stdout.write(`${line}\n`);

function fail(headline, ...detail) {
  out();
  out(`  ${headline}`);
  for (const line of detail) out(`  ${line}`);
  out();
  process.exit(1);
}

function step(title) {
  out();
  out(`  ${title}`);
}

function run(args, { env = {}, cwd = repoRoot, capture = false } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: 'true', CHECKPOINT_DISABLE: '1', ...env },
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error !== undefined) fail(`Could not run ${args[0]}`, result.error.message);
  if (result.status !== 0) {
    if (capture && typeof result.stdout === 'string') process.stdout.write(result.stdout);
    fail(`Step failed with exit code ${result.status}.`, 'Nothing below this line ran.');
  }
  return typeof result.stdout === 'string' ? result.stdout : '';
}

/** The bin entry of an installed package, resolved through the module graph rather than PATH. */
function binOf(name, key = name) {
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[key];
  if (bin === undefined) throw new Error(`${name} has no ${key} bin entry`);
  return join(dirname(manifestPath), bin);
}

// ---------------------------------------------------------------- checks

function checkNode() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const [wantMajor, wantMinor] = MINIMUM_NODE;
  const ok = major > wantMajor || (major === wantMajor && minor >= wantMinor);
  if (!ok) {
    fail(
      `Node ${wantMajor}.${wantMinor} or newer is required; this is ${process.versions.node}.`,
      'The workspace uses import.meta.dirname, which arrived in 20.11.',
      'nvm: nvm install 22 && nvm use 22',
    );
  }
  out(`  node      ${process.versions.node}`);
}

function checkDependencies() {
  const missing = [];
  for (const [name, resolver] of [
    ['tsx', require],
    ['vitest', require],
    ['prisma', requireFromDb],
    ['@prisma/client', requireFromDb],
  ]) {
    try {
      resolver.resolve(`${name}/package.json`);
    } catch {
      missing.push(name);
    }
  }
  for (const workspace of ['@oneresi/contracts', '@oneresi/db']) {
    if (!existsSync(join(repoRoot, 'node_modules', ...workspace.split('/'))))
      missing.push(workspace);
  }
  if (missing.length > 0) {
    fail(
      `Dependencies are not installed: ${missing.join(', ')} cannot be resolved.`,
      'Run `pnpm install` first. This script deliberately does not install anything —',
      'one install, done on purpose, is what keeps the lock file from being rewritten',
      'by three parallel streams (docs/plan/WIRING.md).',
    );
  }
  out(`  packages  installed`);
}

// ---------------------------------------------------------------- the work

function generateSchemas() {
  step('schemas   one base schema, two providers');
  run([join(dbPackage, 'scripts', 'generate-schemas.mjs')], { cwd: dbPackage });
}

function generateClients() {
  step('clients   prisma generate for both providers');
  const prismaWrapper = join(dbPackage, 'scripts', 'prisma.mjs');
  run([prismaWrapper, 'generate'], { cwd: dbPackage, env: { DB_TARGET: 'local' } });
  // Both clients have to exist: src/client.ts imports the PostgreSQL one for its types even when
  // SQLite is the live target, so a local-only machine still needs it generated.
  run([prismaWrapper, 'generate'], {
    cwd: dbPackage,
    env: { DB_TARGET: 'cloud', DATABASE_URL: CODEGEN_URL },
  });
}

function applyMigrations() {
  step('migrate   applying every migration to the local file');
  run([join(dbPackage, 'scripts', 'prisma.mjs'), 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { DB_TARGET: 'local' },
  });
}

function seed() {
  step('seed      convergent, so running this twice changes nothing');
  const output = run([binOf('tsx'), join(dbPackage, 'src', 'seed.ts')], {
    cwd: dbPackage,
    env: { DB_TARGET: 'local' },
    capture: true,
  });
  process.stdout.write(output);
  return [...output.matchAll(/^\s*(\S+@\S+)\s+(\S+)\s*$/gm)].map((m) => ({
    email: m[1],
    password: m[2],
  }));
}

// ---------------------------------------------------------------- reporting

const LOCAL_URL = 'http://localhost:3000';

function summary(accounts) {
  const databaseFile = join(repoRoot, '.data', 'oneresi.db');
  const webApp = existsSync(join(repoRoot, 'apps', 'web'));

  out();
  out('  ────────────────────────────────────────────────────────────────');
  out();
  out('  Local setup is ready.');
  out();
  out(`  database  ${relative(repoRoot, databaseFile).replaceAll('\\', '/')}  (SQLite, no server)`);
  out(`  target    local — DB_TARGET=cloud switches to PostgreSQL and needs DATABASE_URL`);
  out();

  if (accounts.length > 0) {
    out('  sign in with');
    for (const account of accounts) out(`    ${account.email.padEnd(24)}${account.password}`);
    out();
    out('  These are generated, not committed. SEED_PASSWORD sets a different one.');
  } else {
    out('  The seed printed no credentials; scroll up for its output.');
  }
  out();

  out(
    webApp
      ? `  next      pnpm dev   →  ${LOCAL_URL}`
      : `  next      ${LOCAL_URL} once apps/web is scaffolded; until then: pnpm verify`,
  );
  out();
}

function main() {
  out();
  out('  OneResi — local bootstrap');
  out();
  checkNode();
  checkDependencies();

  generateSchemas();
  generateClients();
  applyMigrations();
  const accounts = seed();
  summary(accounts);
  return 0;
}

process.exit(main());
