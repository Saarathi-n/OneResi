import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './client.js';

/**
 * Constraint tests: one per index, asserting the *violation* rather than the happy path.
 *
 * This is the only kind of test that would have caught the two missing indexes in the previous
 * build (D-17, D-18). Every test here runs against whichever engine DB_TARGET names, so the same
 * bodies prove the same guarantees on SQLite and on PostgreSQL — see scripts/run-parity.mjs.
 */

/**
 * The shared harness lives at the repository root, outside this package's `rootDir`, and
 * packages/db is a composite project whose `include` is `src/**` only — so a static import of
 * test/helpers from here is TS6059/TS6307 under `tsc --build`, not a type error I can fix in a
 * test. Loading it through a computed specifier keeps `pnpm typecheck` honest without weakening
 * the test or duplicating the fixtures.
 *
 * To remove this indirection, `packages/db/tsconfig.json` needs the harness in its file list — a
 * request for the foundation owner, per docs/plan/WIRING.md.
 */
interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
interface Fixtures {
  readonly aBlock: (db: Db, name?: string) => Promise<{ id: number }>;
  readonly aUnit: (
    db: Db,
    blockId: number,
    overrides?: { label?: string; type?: string; monthlyChargePaise?: number },
  ) => Promise<{ id: number }>;
  readonly aUser: (
    db: Db,
    overrides?: { role?: string; status?: string; unitId?: number; email?: string },
  ) => Promise<{ id: number }>;
  readonly aFacility: (db: Db, overrides?: { name?: string }) => Promise<{ id: number }>;
  readonly onDay: (iso: string) => Date;
}
interface HashAssertions {
  readonly expectNoHash: (value: unknown, label?: string) => void;
  readonly expectNoHashField: (value: unknown, label?: string) => void;
}

const HARNESS = '../../../test/helpers/database.js';
const FIXTURES = '../../../test/helpers/fixtures.js';
const NO_HASH = '../../../test/helpers/expect-no-hash.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aBlock, aFacility, aUnit, aUser, onDay } = (await import(FIXTURES)) as Fixtures;
const { expectNoHash, expectNoHashField } = (await import(NO_HASH)) as HashAssertions;

let db: Db;
let provider: 'sqlite' | 'postgresql';
let committeeId: number;

beforeAll(async () => {
  const opened = await testDatabase();
  db = opened.db;
  provider = opened.provider;
  committeeId = (await aUser(db, { role: 'A' })).id;
});

/** Runs a write that must be refused, and hands back what the engine said. */
async function refused(write: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await write();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return {
      code: typeof code === 'string' ? code : '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error('The database accepted a write it was supposed to refuse');
}

describe('the composite unique index on (unitId, period)', () => {
  it('refuses a second invoice for the same unit and period', async () => {
    const unit = await aUnit(db, (await aBlock(db)).id);
    const invoice = {
      unitId: unit.id,
      raisedById: committeeId,
      period: '2026-09',
      amountPaise: 350_000,
      dueOn: onDay('2026-09-10'),
    };

    await db.invoice.create({ data: invoice });
    const violation = await refused(() => db.invoice.create({ data: invoice }));

    // P2002 is Prisma's unique-constraint code on both engines. UC-21's "refuses to run twice for
    // a period" is therefore a database guarantee, not an application check a concurrent request
    // can slip past (D-17).
    expect(violation.code).toBe('P2002');
    expect(await db.invoice.count({ where: { unitId: unit.id } })).toBe(1);
  });

  it('is composite — the same period for another unit, and another period for the same unit', async () => {
    const block = await aBlock(db);
    const first = await aUnit(db, block.id);
    const second = await aUnit(db, block.id);
    const base = { raisedById: committeeId, amountPaise: 350_000, dueOn: onDay('2026-10-10') };

    await db.invoice.create({ data: { ...base, unitId: first.id, period: '2026-10' } });
    await db.invoice.create({ data: { ...base, unitId: second.id, period: '2026-10' } });
    await db.invoice.create({ data: { ...base, unitId: first.id, period: '2026-11' } });

    expect(await db.invoice.count({ where: { period: '2026-10' } })).toBe(2);
    expect(await db.invoice.count({ where: { unitId: first.id } })).toBe(2);
  });
});

describe('the partial unique index on a live booking slot', () => {
  const slot = (facilityId: number, unitId: number) => ({
    facilityId,
    unitId,
    bookingDate: onDay('2026-09-20'),
    startTime: '18:00',
    endTime: '19:00',
    amountPaise: 15_000,
  });

  it('refuses a second live booking for the same facility, date and start', async () => {
    const facility = await aFacility(db);
    const unit = await aUnit(db, (await aBlock(db)).id);
    const other = await aUnit(db, (await aBlock(db)).id);

    await db.booking.create({ data: slot(facility.id, unit.id) });
    const violation = await refused(() => db.booking.create({ data: slot(facility.id, other.id) }));

    expect(violation.code).toBe('P2002');
    expect(await db.booking.count({ where: { facilityId: facility.id } })).toBe(1);
  });

  it('leaves a neighbouring slot alone', async () => {
    const facility = await aFacility(db);
    const unit = await aUnit(db, (await aBlock(db)).id);

    await db.booking.create({ data: slot(facility.id, unit.id) });
    await db.booking.create({
      data: { ...slot(facility.id, unit.id), startTime: '19:00', endTime: '20:00' },
    });
    await db.booking.create({
      data: { ...slot(facility.id, unit.id), bookingDate: onDay('2026-09-21') },
    });

    expect(await db.booking.count({ where: { facilityId: facility.id } })).toBe(3);
  });

  it('frees the slot when the booking that held it is cancelled', async () => {
    const facility = await aFacility(db);
    const unit = await aUnit(db, (await aBlock(db)).id);

    const held = await db.booking.create({ data: slot(facility.id, unit.id) });

    // Second attempt while the first is live: refused.
    expect(
      (await refused(() => db.booking.create({ data: slot(facility.id, unit.id) }))).code,
    ).toBe('P2002');

    await db.booking.update({ where: { id: held.id }, data: { status: 'CANCELLED' } });

    // Third attempt after the cancellation: accepted. This is the case a plain
    // UNIQUE (facility, date, slot) breaks — a cancelled row would occupy the slot forever and
    // UC-12's "cancelling releases the slot" would be unsatisfiable (D-18, ADR 0003).
    const rebooked = await db.booking.create({ data: slot(facility.id, unit.id) });
    expect(rebooked.status).toBe('PENDING');

    // And the slot is held again by the new row.
    expect(
      (await refused(() => db.booking.create({ data: slot(facility.id, unit.id) }))).code,
    ).toBe('P2002');

    const rows = await db.booking.findMany({
      where: { facilityId: facility.id },
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    });
    expect(rows).toEqual([
      { id: held.id, status: 'CANCELLED' },
      { id: rebooked.id, status: 'PENDING' },
    ]);
  });

  it('does not let a rejected booking hold a slot either', async () => {
    const facility = await aFacility(db);
    const unit = await aUnit(db, (await aBlock(db)).id);

    const asked = await db.booking.create({ data: slot(facility.id, unit.id) });
    await db.booking.update({ where: { id: asked.id }, data: { status: 'REJECTED' } });

    await expect(db.booking.create({ data: slot(facility.id, unit.id) })).resolves.toMatchObject({
      status: 'PENDING',
    });
  });

  it('covers exactly the two statuses that hold a slot', async () => {
    // Belt and braces on the index definition itself, because the WHERE clause is hand-written SQL
    // in the migration and Prisma cannot see it.
    const sql =
      provider === 'sqlite'
        ? `SELECT sql AS definition FROM sqlite_master WHERE name = 'booking_live_slot_key'`
        : `SELECT indexdef AS definition FROM pg_indexes WHERE indexname = 'booking_live_slot_key'`;
    const rows = await db.$queryRawUnsafe<{ definition: string }[]>(sql);

    expect(rows).toHaveLength(1);
    const definition = rows[0]?.definition ?? '';
    expect(definition).toMatch(/UNIQUE/i);
    expect(definition).toMatch(/PENDING/);
    expect(definition).toMatch(/CONFIRMED/);
    expect(definition).not.toMatch(/COMPLETED/);
  });
});

describe('a rolled-back transaction', () => {
  it('leaves nothing behind, not even the rows written before the failure', async () => {
    const name = `Rollback Block ${Date.now()}`;

    await expect(
      db.$transaction(async (tx) => {
        const block = await tx.block.create({ data: { name, floors: 4 } });
        await tx.unit.create({
          data: {
            blockId: block.id,
            label: 'R-101',
            type: 'FLAT_2BHK',
            monthlyChargePaise: 350_000,
          },
        });
        // Something later in the same use case fails — a validation, a constraint, a timeout.
        throw new Error('use case failed after two writes');
      }),
    ).rejects.toThrow('use case failed after two writes');

    // Asserted by row count, because the previous build's stand-in faked transactions: it applied
    // every write and then swallowed the error, so a partial write was the normal outcome (D-25).
    expect(await db.block.count({ where: { name } })).toBe(0);
    expect(await db.unit.count({ where: { label: 'R-101' } })).toBe(0);
  });

  it('commits when nothing fails, so the previous assertion means something', async () => {
    const name = `Committed Block ${Date.now()}`;

    await db.$transaction(async (tx) => {
      const block = await tx.block.create({ data: { name, floors: 4 } });
      await tx.unit.create({
        data: { blockId: block.id, label: 'C-101', type: 'FLAT_2BHK', monthlyChargePaise: 350_000 },
      });
    });

    expect(await db.block.count({ where: { name } })).toBe(1);
    expect(await db.unit.count({ where: { label: 'C-101' } })).toBe(1);
  });
});

describe('passwordHash', () => {
  it('is excluded by select, and the exclusion is asserted by shape not by field name', async () => {
    const person = await aUser(db, { email: 'hash-check@oneresi.test' });

    const projected = await db.residentUser.findMany({
      where: { id: person.id },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    expectNoHash(projected, 'residentUser.findMany(select)');
    expectNoHashField(projected, 'residentUser.findMany(select)');
    expect(projected).toHaveLength(1);
  });

  it('is excluded by omit — along with every other credential column', async () => {
    const person = await aUser(db, { email: 'omit-check@oneresi.test' });

    const row = await db.residentUser.findUniqueOrThrow({
      where: { id: person.id },
      omit: { passwordHash: true, resetTokenHash: true },
    });

    expectNoHash(row, 'residentUser.findUnique(omit)');
    expectNoHashField(row, 'residentUser.findUnique(omit)');
    expect(row.email).toBe('omit-check@oneresi.test');
  });

  it('is not the only column that has to go', async () => {
    const person = await aUser(db, { email: 'reset-token@oneresi.test' });

    const halfDone = await db.residentUser.findUniqueOrThrow({
      where: { id: person.id },
      omit: { passwordHash: true },
    });

    // `resetTokenHash` is a password equivalent for fifteen minutes (D-22), and it rides along on
    // any read that only remembers to drop `passwordHash`. A service returning a row shaped like
    // this has not finished the job.
    expect(() => expectNoHashField(halfDone, 'omit(passwordHash) only')).toThrow(/resetTokenHash/);
  });

  it('is caught by the helper when it does leak, so the assertion above is not vacuous', async () => {
    const person = await aUser(db, { email: 'leak-check@oneresi.test' });
    const row = await db.residentUser.findUniqueOrThrow({ where: { id: person.id } });

    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(() => expectNoHash(row, 'unprojected row')).toThrow(/Password hash reached the caller/);
    expect(() => expectNoHash({ deep: [{ nested: { credential: row.passwordHash } }] })).toThrow(
      /body\.deep\[0\]\.nested\.credential/,
    );
    // A serialised body is still a body.
    expect(() => expectNoHash(JSON.stringify({ user: row }))).toThrow(/Password hash/);
    // An emptied column is still a leaked column.
    expect(() => expectNoHashField({ user: { id: 1, passwordHash: '' } })).toThrow(
      /Hash column present/,
    );
  });
});
