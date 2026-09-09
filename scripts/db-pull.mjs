#!/usr/bin/env node
/**
 * Cloud → local: brings the property registry down from the DATABASE_URL database into the local
 * SQLite file, so a fresh install has the blocks, units and charges and facilities it needs before
 * anyone signs in (ADR 0004: sync is a command, never a behaviour).
 *
 *   DATABASE_URL='postgresql://...' node scripts/db-pull.mjs
 *   DATABASE_URL='postgresql://...' node scripts/db-pull.mjs --dry-run
 *   DATABASE_URL='postgresql://...' node scripts/db-pull.mjs --yes            # no confirmation
 *   LOCAL_DB_FILE=.data/other.db DATABASE_URL='...' node scripts/db-pull.mjs  # a different local file
 *
 * Moves blocks, units (with their charges) and facilities — nothing else. Accounts, sessions,
 * tokens, notifications and the outbox have no local copy to converge and are never read or
 * written here.
 *
 * Deterministic and idempotent: upserts by natural key inside one transaction, so a row present on
 * both sides converges instead of duplicating, and running it twice moves nothing the second time.
 * Rows that exist only locally are reported and left alone, not deleted — removing a property row
 * that invoices point at is a decision, not a side effect. Refuses a DATABASE_URL that points at
 * this machine unless --allow-local says a second local database is standing in for the cloud.
 */
import {
  assertCloudUrl,
  cloudUrl,
  confirm,
  explain,
  localTarget,
  openClient,
  out,
  parseArgs,
  planProperty,
  planTotals,
  printPlan,
  readProperty,
  redactUrl,
  section,
  verifyConvergence,
  applyProperty,
} from './db-sync-lib.mjs';

const HELP = `
  db-pull brings the property registry down from the cloud database into the local file.

    DATABASE_URL=<cloud url> node scripts/db-pull.mjs [options]

  options
    --dry-run      print the plan, write nothing
    --yes          do not ask for confirmation (required when stdin is not a terminal)
    --allow-local  permit a DATABASE_URL that points at this machine (smoke tests only)

  environment
    DATABASE_URL   the cloud side, normally from \`pnpm cloud:env\`
    LOCAL_DB_FILE  the local side, defaulting to .data/oneresi.db

  moves blocks, units and facilities only. Accounts, tokens and the outbox are not synced.
`;

async function main() {
  const flags = parseArgs(process.argv.slice(2), ['--dry-run', '--yes', '--allow-local']);
  const sourceUrl = cloudUrl();
  assertCloudUrl(sourceUrl, { allowLocal: flags['--allow-local'] });
  const target = localTarget();

  out();
  out('  db-pull  cloud → local');
  out(`  source   ${redactUrl(sourceUrl)}`);
  out(`  target   ${target.file.replaceAll('\\', '/')}  (SQLite)`);
  out();

  const cloud = await openClient(sourceUrl);
  const local = await openClient(target.url);
  try {
    const plan = planProperty(await readProperty(cloud), await readProperty(local));
    printPlan(plan);

    const totals = planTotals(plan);
    if (flags['--dry-run']) {
      out('  dry run — nothing was written.');
      return 0;
    }
    if (totals.creates === 0 && totals.updates === 0) {
      out('  The local registry already matches the cloud one. Nothing to move.');
      return 0;
    }

    const agreed =
      flags['--yes'] ||
      (await confirm(
        `Write ${totals.creates} new and ${totals.updates} changed rows into ${target.file.replaceAll('\\', '/')}? Rows only the local file has are left alone. Type yes to continue:`,
      ));
    if (!agreed) {
      out('  Cancelled — nothing was written.');
      return 0;
    }

    await applyProperty(local, plan);

    const verification = verifyConvergence(await readProperty(cloud), await readProperty(local));
    section('verification');
    out(`  ${verification.checked} rows checked against the cloud registry.`);
    if (verification.ok) {
      out('  Every block, unit and facility the cloud knows now matches locally.');
    } else {
      out('  The registry still disagrees with the cloud after the write:');
      for (const mismatch of verification.mismatches) out(`    ${mismatch}`);
      return 1;
    }
    return 0;
  } finally {
    await cloud.$disconnect().catch(() => undefined);
    await local.$disconnect().catch(() => undefined);
  }
}

if (process.argv.includes('--help')) {
  out(HELP);
} else {
  main().catch((failure) => {
    process.stderr.write(`\n  db-pull failed: ${explain(failure)}\n\n`);
    process.exitCode = 1;
  });
}
