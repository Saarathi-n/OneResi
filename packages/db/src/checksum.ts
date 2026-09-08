import { createHash } from 'node:crypto';
import { getDb, liveTarget } from './client.js';
import type { Db } from './client.js';
import { DOMAIN_TABLES } from './tables.js';
import type { DomainTable } from './tables.js';

/**
 * A content digest of the database, table by table.
 *
 * This is the tool docs/plan/05-testing.md names for the seed gate — "running it twice leaves
 * identical row counts and identical checksums" — and a row count alone cannot pass it honestly:
 * five users before, five users after, every one of them with a rewritten `passwordHash` and a
 * bumped `updatedAt` still counts five. A digest of the rows sees the rewrite, which is why the
 * hash covers values, not counts.
 *
 * What goes into it: every column of every domain table, in DOMAIN_TABLES order, each table's rows
 * sorted by their canonical form so two runs agree on byte order — never by `id`, which differs
 * between targets by design (docs/plan/02-architecture.md, and the reason `id` is the one column
 * left out). Dates cross as ISO strings, keys are sorted, and the digest is a SHA-256 — nothing
 * readable leaves this module, which is why `passwordHash` is included rather than skipped: it is
 * a hash of a hash, it is the column defect D-01's seed fix must not rewrite, and leaving it out
 * would blind the gate to exactly that.
 */

type Row = Record<string, unknown>;

/** bigint would throw in JSON.stringify; a Decimal-free schema sends none, but this stays safe. */
function json(value: unknown): string {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return `${item}n`;
    return item;
  });
  return text ?? 'null';
}

/** One row's canonical form: every column but `id`, alphabetically keyed. */
function canonicalRow(row: Row): string {
  const columns = Object.keys(row).filter((key) => key !== 'id').sort();
  const canonical: Row = {};
  for (const key of columns) canonical[key] = row[key];
  return json(canonical);
}

export interface TableChecksum {
  readonly table: DomainTable;
  readonly rowCount: number;
  /** SHA-256 of the table's canonical rows. Empty string when the table is empty. */
  readonly digest: string;
}

export interface DatabaseChecksum {
  /** SHA-256 over every table's line — the one value a gate compares. */
  readonly digest: string;
  readonly tables: readonly TableChecksum[];
}

/** Rows of one table, sorted by their canonical form so the order never depends on `id`. */
async function rowsOf(db: Db, table: DomainTable): Promise<string[]> {
  const delegate = db[table] as unknown as {
    findMany(): Promise<readonly Row[]>;
  };
  const rows = await delegate.findMany();
  return rows.map(canonicalRow).sort();
}

/**
 * The digest of one database: every domain table, in write order, rows reduced to their content.
 * Read-only — running it twice must itself be a no-op, or it could not gate anything.
 */
export async function checksum(db: Db): Promise<DatabaseChecksum> {
  const tables: TableChecksum[] = [];
  for (const table of DOMAIN_TABLES) {
    const lines = await rowsOf(db, table);
    const digest =
      lines.length === 0 ? '' : createHash('sha256').update(lines.join('\n')).digest('hex');
    tables.push({ table, rowCount: lines.length, digest });
  }

  const whole = tables.map((t) => `${t.table}:${t.rowCount}:${t.digest}`).join('\n');
  return { digest: createHash('sha256').update(whole).digest('hex'), tables };
}

if (import.meta.filename === process.argv[1]) {
  const db = await getDb();
  const target = await liveTarget();

  const result = await checksum(db);
  process.stdout.write(`\n  checksum  ${target.name} (${target.label})\n\n`);
  for (const t of result.tables) {
    const shown = t.digest === '' ? '(empty)' : t.digest.slice(0, 16);
    process.stdout.write(`    ${t.table.padEnd(16)}${String(t.rowCount).padEnd(6)}${shown}\n`);
  }
  process.stdout.write(`\n  digest  ${result.digest}\n\n`);

  await db.$disconnect();
}
