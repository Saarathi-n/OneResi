#!/usr/bin/env node
/**
 * The parity runner. The same suite, twice, once per database engine.
 *
 * Every integration test in this repository runs against SQLite and against PostgreSQL, with the
 * same bodies and the same fixtures, because the previous build's failures were overwhelmingly of
 * one kind: the thing that had actually been exercised was not the thing that would be deployed. A
 * hand-written store stood in for Prisma whenever a variable was unset — which was the default — and
 * it accepted unit types the real schema rejected, ignored `select`, faked transactions and returned
 * unfiltered reads (D-15, D-16, D-25, D-27). A test that must pass identically on both engines makes
 * that impossible to reintroduce.
 *
 *   pnpm test:parity                              # SQLite, then PostgreSQL if it can
 *   TEST_DATABASE_URL=postgresql://... pnpm test:parity
 *   pnpm test:parity packages/db          # a subset, still on both engines
 *
 * The PostgreSQL half needs a throwaway PostgreSQL instance. Without `TEST_DATABASE_URL` it is
 * skipped with a notice and the run still succeeds — a developer without Docker must be able to
 * work, and CI always supplies one (.github/workflows/verify.yml).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const reportDir = join(repoRoot, '.data', 'parity');
/** Anything after the script name is a vitest filter, applied identically to both engines. */
const filters = process.argv.slice(2);

const out = (line = '') => process.stdout.write(`${line}\n`);

/** Resolved through the module graph rather than PATH, so `node scripts/run-parity.mjs` works too. */
function vitestEntry() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('vitest/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vitest;
  if (bin === undefined) throw new Error('Cannot locate the vitest CLI entry point');
  return join(dirname(manifestPath), bin);
}

/**
 * The suite reads DATABASE_URL, because that is what the application reads; TEST_DATABASE_URL is
 * the name CI uses so a stray value can never point a test run at a real database.
 */
function cloudUrl(raw) {
  if (raw.includes('sslmode=')) return { url: raw, note: undefined };
  const url = `${raw}${raw.includes('?') ? '&' : '?'}sslmode=disable`;
  return {
    url,
    note: 'TEST_DATABASE_URL did not state an sslmode; assuming disable, which suits a container.',
  };
}

function runPass({ target, url, note }) {
  const reportFile = join(reportDir, `${target}.json`);
  const junitFile = join(repoRoot, 'test-results', `junit-${target}.xml`);
  rmSync(reportFile, { force: true });
  rmSync(junitFile, { force: true });

  out();
  out(`  ── ${target} ${'─'.repeat(Math.max(0, 60 - target.length))}`);
  if (note !== undefined) out(`  ${note}`);
  out();

  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      vitestEntry(),
      'run',
      ...filters,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportFile}`,
      // Naming the reporters on the command line replaces the ones in vitest.config.ts, so the
      // junit file CI uploads has to be asked for here or it is never written. One per target,
      // because two passes writing one path is a report that lies about half the run.
      ...(process.env.CI === 'true' ? ['--reporter=junit', `--outputFile.junit=${junitFile}`] : []),
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        DB_TARGET: target,
        ...(url === undefined ? {} : { DATABASE_URL: url }),
        // The CLI's version notice interleaves with the reporter and says nothing useful here.
        PRISMA_HIDE_UPDATE_MESSAGE: 'true',
        CHECKPOINT_DISABLE: '1',
      },
    },
  );

  const elapsed = Date.now() - startedAt;
  let counts = { total: 0, passed: 0, failed: 0, skipped: 0, files: 0, broken: 0 };
  try {
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    const files = Array.isArray(report.testResults) ? report.testResults : [];
    counts = {
      total: report.numTotalTests ?? 0,
      passed: report.numPassedTests ?? 0,
      failed: report.numFailedTests ?? 0,
      skipped: report.numPendingTests ?? 0,
      files: files.length,
      // A file that throws while loading reports no failing tests at all, which is how a missing
      // dependency or a syntax error hides. Counted separately so the table explains itself.
      broken: files.filter((file) => file.status === 'failed').length,
    };
  } catch {
    // No report means vitest died before it could write one; the exit code is the truth.
  }

  return {
    target,
    ok: result.status === 0,
    status: result.status ?? 1,
    elapsed,
    ...counts,
  };
}

// ---------------------------------------------------------------- side by side

const COLUMNS = [
  { head: '', of: (r) => r.target },
  { head: 'result', of: (r) => (r.ok ? 'pass' : 'FAIL') },
  { head: 'files', of: (r) => String(r.files) },
  { head: 'broken', of: (r) => String(r.broken) },
  { head: 'tests', of: (r) => String(r.total) },
  { head: 'passed', of: (r) => String(r.passed) },
  { head: 'failed', of: (r) => String(r.failed) },
  { head: 'skipped', of: (r) => String(r.skipped) },
  { head: 'seconds', of: (r) => (r.elapsed / 1000).toFixed(1) },
];

function table(passes) {
  const rows = [COLUMNS.map((c) => c.head), ...passes.map((p) => COLUMNS.map((c) => c.of(p)))];
  const widths = COLUMNS.map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const [index, row] of rows.entries()) {
    out(`  ${row.map((cell, i) => cell.padEnd(widths[i])).join('  ')}`);
    if (index === 0) out(`  ${widths.map((w) => '─'.repeat(w)).join('  ')}`);
  }
}

function agreement(passes) {
  if (passes.length < 2) return undefined;
  const [first, second] = passes;
  if (first.total !== second.total) {
    return `The two engines ran a different number of tests (${first.total} vs ${second.total}). One of them is skipping something the other runs, which is the defect class this suite exists to prevent.`;
  }
  if (first.passed !== second.passed || first.failed !== second.failed) {
    return 'The two engines disagreed on which tests pass. That difference is the finding — read the two reports above.';
  }
  return undefined;
}

function main() {
  mkdirSync(reportDir, { recursive: true });
  const passes = [runPass({ target: 'local' })];

  const raw = process.env.TEST_DATABASE_URL;
  let skipped = false;
  if (raw === undefined || raw.trim() === '') {
    skipped = true;
    // A report from an earlier run that *did* have a database would otherwise sit here looking
    // current, and the workflow uploads this directory as an artifact. A skipped pass leaves no
    // report behind.
    rmSync(join(reportDir, 'cloud.json'), { force: true });
  } else {
    const { url, note } = cloudUrl(raw.trim());
    passes.push(runPass({ target: 'cloud', url, note }));
  }

  out();
  out('  ── parity ───────────────────────────────────────────────────────');
  out();
  table(passes);
  out();

  if (skipped) {
    out('  cloud     skipped');
    out();
    out('  The PostgreSQL half of the parity suite needs a PostgreSQL URL in TEST_DATABASE_URL —');
    out('  a throwaway database, dropped afterwards, never a real one. For example:');
    out();
    out('    docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16');
    out(
      '    TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm test:parity',
    );
    out();
    out('  Not a failure: CI runs both halves on every pull request, so the engines are compared');
    out('  before anything merges. See .github/workflows/verify.yml.');
    out();
  }

  const disagreement = agreement(passes);
  if (disagreement !== undefined) {
    out(`  ${disagreement}`);
    out();
  }

  for (const pass of passes.filter((p) => !p.ok && p.failed === 0 && p.broken > 0)) {
    out(
      `  ${pass.target}: ${pass.broken} test file${pass.broken === 1 ? '' : 's'} failed to load rather than failing an assertion — usually an uninstalled dependency.`,
    );
    out();
  }

  const failed = passes.filter((p) => !p.ok);
  out(
    failed.length === 0 && disagreement === undefined
      ? `  ${passes.length === 1 ? 'one engine' : 'both engines'} green`
      : `  parity failed: ${failed.map((p) => p.target).join(', ') || 'engines disagreed'}`,
  );
  out();

  return failed.length === 0 && disagreement === undefined ? 0 : 1;
}

process.exit(main());
