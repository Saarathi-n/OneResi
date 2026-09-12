#!/usr/bin/env node
/**
 * Local → cloud: pushes local property edits — blocks, units and their charges, facilities — up to
 * the DATABASE_URL database. The inverse of db-pull, with the safety rated up a notch because the
 * side being written is the live one.
 *
 *   DATABASE_URL='postgresql://...' node scripts/db-push.mjs              # plan only (the default)
 *   DATABASE_URL='postgresql://...' node scripts/db-push.mjs --execute   # plan, confirm, write
 *   DATABASE_URL='postgresql://...' node scripts/db-push.mjs --execute --yes
 *
 * A push is a dry run unless --execute is passed. With it, the command still asks for
 * confirmation (ADR 0004) unless --yes is given.
 *
 * Moves blocks, units and facilities only. It refuses, by construction, to push anything else:
 * there is no code path here that writes users, password hashes, sessions, refresh tokens,
 * notifications, receipts or outbox rows — that direction does not exist, because the local file
 * is a workspace and the cloud database is the record, and the record's accounts are not the
 * workspace's to overwrite.
 *
 * Idempotent: upserts by natural key inside one transaction; running it twice moves nothing the
 * second time. Rows that exist only in the cloud are reported and left alone. Refuses a
 * DATABASE_URL that points at this machine unless --allow-local says a second local database is
 * standing in for the cloud one.
 */
import {
  applyProperty,
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
} from './db-sync-lib.mjs';

const HELP = `
  db-push sends local property edits up to the cloud database.

    DATABASE_URL=<cloud url> node scripts/db-push.mjs [options]

  options
    --dry-run      print the plan, write nothing (this is the default)
    --execute      actually write, after asking for confirmation
    --yes          do not ask for confirmation (required when stdin is not a terminal)
    --allow-local  permit a DATABASE_URL that points at this machine (smoke tests only)

  environment
    DATABASE_URL   the cloud side, normally from \`pnpm cloud:env\`
    LOCAL_DB_FILE  the local side, defaulting to .data/grihaone.db

  moves blocks, units and facilities only. Users, tokens and outbox rows are never pushed.
`;

async function main() {
  const flags = parseArgs(process.argv.slice(2), [
    '--dry-run',
    '--execute',
    '--yes',
    '--allow-local',
  ]);
  const targetUrl = cloudUrl();
  assertCloudUrl(targetUrl, { allowLocal: flags['--allow-local'] });
  const source = localTarget();

  out();
  out('  db-push  local → cloud');
  out(`  source   ${source.file.replaceAll('\\', '/')}  (SQLite)`);
  out(`  target   ${redactUrl(targetUrl)}`);
  out();

  const local = await openClient(source.url);
  const cloud = await openClient(targetUrl);
  try {
    const plan = planProperty(await readProperty(local), await readProperty(cloud));
    printPlan(plan);

    const totals = planTotals(plan);
    if (!flags['--execute']) {
      out('  Push is a dry run unless --execute is passed — nothing was written.');
      return 0;
    }
    if (totals.creates === 0 && totals.updates === 0) {
      out('  The cloud registry already matches the local one. Nothing to move.');
      return 0;
    }

    const agreed =
      flags['--yes'] ||
      (await confirm(
        `Write ${totals.creates} new and ${totals.updates} changed rows to ${redactUrl(targetUrl)}? Rows only the cloud has are left alone. Type yes to continue:`,
      ));
    if (!agreed) {
      out('  Cancelled — nothing was written.');
      return 0;
    }

    await applyProperty(cloud, plan);

    const verification = verifyConvergence(await readProperty(local), await readProperty(cloud));
    section('verification');
    out(`  ${verification.checked} rows checked against the local registry.`);
    if (verification.ok) {
      out('  Every block, unit and facility the local file knows now matches the cloud.');
    } else {
      out('  The cloud registry still disagrees with the local one after the write:');
      for (const mismatch of verification.mismatches) out(`    ${mismatch}`);
      return 1;
    }
    return 0;
  } finally {
    await local.$disconnect().catch(() => undefined);
    await cloud.$disconnect().catch(() => undefined);
  }
}

if (process.argv.includes('--help')) {
  out(HELP);
} else {
  main().catch((failure) => {
    process.stderr.write(`\n  db-push failed: ${explain(failure)}\n\n`);
    process.exitCode = 1;
  });
}
