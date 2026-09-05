#!/usr/bin/env node
/**
 * One base schema, two providers.
 *
 * Reads prisma/schema.base.prisma and writes prisma/<provider>/schema.prisma for each target,
 * substituting the provider name. Nothing else is transformed — the base schema is written under
 * constraints (no enums, no Decimal, no @db.* attributes) that make the two outputs identical
 * apart from the datasource block.
 *
 * `pnpm test` asserts exactly that, so a change to the base schema that breaks portability fails
 * the build rather than surfacing as "works locally, 500s on RDS" (D-15, D-16).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const basePath = join(packageRoot, 'prisma', 'schema.base.prisma');

export const PROVIDERS = ['sqlite', 'postgresql'];

const BANNER = (provider) =>
  [
    '// ---------------------------------------------------------------------------',
    '//  GENERATED FILE — DO NOT EDIT.',
    '//',
    `//  Emitted from prisma/schema.base.prisma for the ${provider} target by`,
    '//  scripts/generate-schemas.mjs. Edit the base schema instead.',
    '// ---------------------------------------------------------------------------',
    '',
  ].join('\n');

export function render(provider, base = readFileSync(basePath, 'utf8')) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider "${provider}"`);
  }
  return BANNER(provider) + base.replaceAll('__PROVIDER__', provider);
}

/** The schema with its datasource and generator blocks stripped — what must match across targets. */
export function portablePart(schema) {
  return schema
    .replace(/generator\s+client\s*\{[^}]*\}/gs, '')
    .replace(/datasource\s+db\s*\{[^}]*\}/gs, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function digestOf(schema) {
  return createHash('sha256').update(portablePart(schema), 'utf8').digest('hex');
}

/** Constructs the base schema forbids, because they are not portable across both providers. */
const FORBIDDEN = [
  [/^\s*enum\s+\w+\s*\{/m, 'enum blocks — SQLite has none; use a string union from @oneresi/contracts'],
  [/@db\.\w+/, '@db.* native type attributes — provider specific by definition'],
  [/\bDecimal\b/, 'Decimal — behaves differently on SQLite; use Int paise'],
  [/\bJson\b/, 'Json — unsupported on SQLite; store JSON as String'],
  [/\bBytes\b/, 'Bytes — avoid; not needed here'],
  [/\w+\s+String\[\]/, 'scalar lists — PostgreSQL only'],
];

export function assertPortable(base) {
  // Strip comments first: the base schema documents these constructs in order to forbid them,
  // and a doc comment saying "no Decimal" must not itself trip the check.
  const code = base.replace(/^\s*\/\/.*$/gm, '');
  const problems = FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, why]) => why);
  if (problems.length > 0) {
    throw new Error(
      `schema.base.prisma uses constructs that are not portable:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

export function generate() {
  const base = readFileSync(basePath, 'utf8');
  assertPortable(base);

  const written = [];
  for (const provider of PROVIDERS) {
    const dir = join(packageRoot, 'prisma', provider);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, 'schema.prisma');
    writeFileSync(target, render(provider, base), 'utf8');
    written.push({ provider, target, digest: digestOf(render(provider, base)) });
  }

  const [first, ...rest] = written;
  for (const other of rest) {
    if (other.digest !== first.digest) {
      throw new Error(
        `Generated schemas diverge beyond the datasource block: ${first.provider} ${first.digest.slice(0, 12)} vs ${other.provider} ${other.digest.slice(0, 12)}`,
      );
    }
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = generate();
  for (const { provider } of written) process.stdout.write(`  schema  ${provider}\n`);
  process.stdout.write(`  digest  ${written[0].digest.slice(0, 16)} (identical across targets)\n`);
}
