#!/usr/bin/env node
/**
 * Reports. Never writes: db-diff opens both databases read-only in effect (it issues counts and
 * selects and nothing else) and prints
 *
 *   - a row-count table across every table, local next to cloud, and
 *   - a natural-key diff of the property registry — which blocks, units and facilities exist on
 *     one side only, and which exist on both with different business fields.
 *
 *   DATABASE_URL='postgresql://...' node scripts/db-diff.mjs
 *   LOCAL_DB_FILE=.data/other.db DATABASE_URL='...' node scripts/db-diff.mjs
 *
 * Counts differing on the operational tables (outbox, notifications, sessions) is normal — those
 * are per-database state — so a difference here is a report, not a failure; the exit code is 0
 * either way and non-zero only when the databases cannot be read at all.
 */
import {
  assertCloudUrl,
  cloudUrl,
  explain,
  localTarget,
  openClient,
  out,
  parseArgs,
  printTable,
  PROPERTY_TABLES,
  readProperty,
  redactUrl,
  sameValue,
  section,
  show,
  tableCounts,
} from './db-sync-lib.mjs';

const HELP = `
  db-diff prints how the local and cloud databases differ. It writes nothing.

    DATABASE_URL=<cloud url> node scripts/db-diff.mjs [options]

  options
    --allow-local  permit a DATABASE_URL that points at this machine (smoke tests only)
    --dry-run      accepted for symmetry with db-pull and db-push; a diff is always dry

  environment
    DATABASE_URL   the cloud side, normally from \`pnpm cloud:env\`
    LOCAL_DB_FILE  the local side, defaulting to .data/grihaone.db
`;

/** Same natural key on both sides, different business fields. */
function fieldDifferences(source, target) {
  const differences = [];
  for (const key of [...source.keys()].sort()) {
    const mine = source.get(key);
    const theirs = target.get(key);
    if (theirs === undefined) continue;
    for (const field of Object.keys(mine.fields)) {
      if (sameValue(mine.fields[field], theirs.fields[field])) continue;
      differences.push(
        `${mine.display}  ${field}: local ${show(mine.fields[field])}, cloud ${show(theirs.fields[field])}`,
      );
    }
  }
  return differences;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2), ['--allow-local', '--dry-run']);
  const cloudSideUrl = cloudUrl();
  assertCloudUrl(cloudSideUrl, { allowLocal: flags['--allow-local'] });
  const local = localTarget();

  out();
  out('  db-diff  local ↔ cloud  (read-only)');
  out(`  local    ${local.file.replaceAll('\\', '/')}  (SQLite)`);
  out(`  cloud    ${redactUrl(cloudSideUrl)}`);
  out();

  const localDb = await openClient(local.url);
  const cloudDb = await openClient(cloudSideUrl);
  try {
    const [localCounts, cloudCounts, localRegistry, cloudRegistry] = [
      await tableCounts(localDb),
      await tableCounts(cloudDb),
      await readProperty(localDb),
      await readProperty(cloudDb),
    ];

    section('row counts');
    printTable(
      ['table', 'local', 'cloud', ''],
      Object.keys(localCounts).map((table) => [
        table,
        localCounts[table],
        cloudCounts[table],
        localCounts[table] === cloudCounts[table] ? '' : 'differs',
      ]),
    );
    out();

    section('property registry');
    const CAP = 10;
    let anyDifference = false;
    for (const table of PROPERTY_TABLES) {
      const mine = localRegistry[table];
      const theirs = cloudRegistry[table];
      const onlyLocal = [...mine.keys()].filter((key) => !theirs.has(key)).sort();
      const onlyCloud = [...theirs.keys()].filter((key) => !mine.has(key)).sort();
      const changed = fieldDifferences(mine, theirs);

      if (onlyLocal.length === 0 && onlyCloud.length === 0 && changed.length === 0) {
        out(`  ${table.padEnd(10)} ${mine.size} rows, identical`);
        continue;
      }
      anyDifference = true;
      out(`  ${table}`);
      for (const key of onlyLocal.slice(0, CAP)) out(`    only local   ${mine.get(key).display}`);
      for (const key of onlyCloud.slice(0, CAP)) out(`    only cloud   ${theirs.get(key).display}`);
      for (const difference of changed.slice(0, CAP)) out(`    changed      ${difference}`);
      if (onlyLocal.length > CAP) out(`    … and ${onlyLocal.length - CAP} more only local`);
      if (onlyCloud.length > CAP) out(`    … and ${onlyCloud.length - CAP} more only cloud`);
      if (changed.length > CAP) out(`    … and ${changed.length - CAP} more changed`);
      out();
    }
    if (!anyDifference) {
      out();
      out('  The property registry agrees on both sides.');
    }
    return 0;
  } finally {
    await localDb.$disconnect().catch(() => undefined);
    await cloudDb.$disconnect().catch(() => undefined);
  }
}

if (process.argv.includes('--help')) {
  out(HELP);
} else {
  main().catch((failure) => {
    process.stderr.write(`\n  db-diff failed: ${explain(failure)}\n\n`);
    process.exitCode = 1;
  });
}
