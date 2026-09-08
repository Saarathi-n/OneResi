import { beforeAll, describe, expect, it } from 'vitest';
import { seed } from './seed.js';
import { checksum } from './checksum.js';
import type { DatabaseChecksum } from './checksum.js';
import type { Db } from './client.js';

/**
 * Seed idempotency, proven by digest.
 *
 * The plan's gate is "running it twice leaves identical row counts and identical checksums" — and
 * the row-count half alone cannot fail honestly, because five users before are five users after
 * even if every one of them was rewritten. The previous build's seed did exactly that: bcrypt sat
 * in an upsert's `update` branch, so every run re-hashed every password and bumped `updatedAt`
 * (D-01). Same counts, different database.
 *
 * So this test compares whole digests: every column of every domain table, taken twice around a
 * second seed. The digest covers `passwordHash` on purpose — it is the column the old seed
 * rewrote, and a checksum that skipped it could not have caught the defect it exists to gate.
 *
 * One honest limit, recorded rather than hidden: the seed computes its demo dates relative to the
 * current month, so the two runs inside this test agree, but the digest itself drifts across a
 * month boundary. Idempotency is "twice in a row", not "forever", and this test asserts the
 * former because that is what a reseed during deploy actually does (D-45).
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
// The shared harness sits outside this package's `rootDir`; a computed specifier keeps the
// composite project honest. See constraints.test.ts for the full explanation.
const HARNESS = '../../../test/helpers/database.js';
const { testDatabase } = (await import(HARNESS)) as Harness;

let db: Db;
let first: DatabaseChecksum;
let second: DatabaseChecksum;
let adminBefore: { createdAt: Date; updatedAt: Date; passwordHash: string } | null;
let adminAfter: { createdAt: Date; updatedAt: Date; passwordHash: string } | null;

const ADMIN_EMAIL = 'committee@oneresi.in';

beforeAll(async () => {
  const opened = await testDatabase();
  db = opened.db;

  await seed(db);
  first = await checksum(db);
  adminBefore = await db.residentUser.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { createdAt: true, updatedAt: true, passwordHash: true },
  });

  await seed(db);
  second = await checksum(db);
  adminAfter = await db.residentUser.findFirst({
    where: { email: ADMIN_EMAIL },
    select: { createdAt: true, updatedAt: true, passwordHash: true },
  });
});

describe('seed, run twice', () => {
  it('leaves the whole-database digest identical', () => {
    expect(second.digest).toBe(first.digest);
  });

  it('leaves every table digest and row count identical', () => {
    // The whole-database digest is the gate, but a per-table diff names the table that moved —
    // which is the difference between a failure you can act on and one you have to query for.
    expect(second.tables.map((t) => [t.table, t.rowCount, t.digest])).toEqual(
      first.tables.map((t) => [t.table, t.rowCount, t.digest]),
    );
  });

  it('does not rewrite the administrator the second time', () => {
    // The digest already proves this globally; this is the local, human-readable half of the same
    // claim, on the exact column the old seed rewrote (D-01): bcrypt sat in the upsert's `update`
    // branch, so every run re-hashed every password and bumped `updatedAt` on a row nothing
    // touched. The row taken before the second seed is compared to the row taken after.
    expect(adminBefore).not.toBeNull();
    expect(adminAfter).not.toBeNull();
    expect(adminAfter?.createdAt).toEqual(adminBefore?.createdAt);
    expect(adminAfter?.updatedAt).toEqual(adminBefore?.updatedAt);
    expect(adminAfter?.passwordHash).toBe(adminBefore?.passwordHash);
  });
});
