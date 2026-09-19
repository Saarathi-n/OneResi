import { beforeAll, describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
import type { OutboxEventInput } from '@grihaone/domain';
import type { Db } from '../client.js';
import { propertyStore } from './property.js';

/**
 * The Prisma truth for PropertyStore: the registration options carry no charge (the applicant
 * never sees one, D-04), the admin list counts units per block, natural-key collisions are nulls,
 * and every mutation keeps its events in the same transaction.
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
  readonly onDay: (iso: string) => Date;
}

const HARNESS = '../../../../test/helpers/database.js';
const FIXTURES = '../../../../test/helpers/fixtures.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aBlock, aUnit, aUser } = (await import(FIXTURES)) as Fixtures;

let db: Db;

beforeAll(async () => {
  db = (await testDatabase()).db;
});

let eventCounter = 0;
function anEvent(): OutboxEventInput {
  eventCounter += 1;
  return {
    type: 'pass.created',
    channel: 'IN_APP',
    payload: { unitId: 1 },
    correlationId: `corr-${eventCounter}`,
  };
}

describe('registrationOptions', () => {
  it('lists active blocks and their active units, alphabetically, with no charge anywhere', async () => {
    const store = propertyStore(db);
    const zebra = await aBlock(db, 'Zebra Court');
    const alpha = await aBlock(db, 'Alpha Court');
    await db.block.update({ where: { id: alpha.id }, data: { active: false } });
    await aUnit(db, zebra.id, { label: 'Z-9' });
    const liveUnit = await aUnit(db, zebra.id, { label: 'Z-1' });
    await db.unit.update({ where: { id: liveUnit.id }, data: { active: false } });
    await aUnit(db, zebra.id, { label: 'Z-2' });

    const options = await store.registrationOptions();

    const mine = options.filter((block) => block.blockId === zebra.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.blockName).toBe('Zebra Court');
    expect(mine[0]?.units.map((unit) => unit.label)).toEqual(['Z-2', 'Z-9']);
    // A registration option says where, never what it costs — the shape itself is the guarantee.
    for (const unit of mine[0]?.units ?? []) {
      expect(Object.keys(unit).sort()).toEqual(['label', 'unitId']);
    }
    expect(options.some((block) => block.blockId === alpha.id)).toBe(false);
  });
});

describe('blocksForAdmin', () => {
  it('includes retired blocks and counts every unit, active or not', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db);
    await aUnit(db, block.id, { label: 'A-1' });
    await aUnit(db, block.id, { label: 'A-2' });
    const retiredUnit = await aUnit(db, block.id, { label: 'A-3' });
    await db.unit.update({ where: { id: retiredUnit.id }, data: { active: false } });

    const view = await store.blocksForAdmin();
    const mine = view.find((entry) => entry.id === block.id);
    expect(mine?.unitCount).toBe(3);
    expect(Object.keys(mine ?? {}).sort()).toEqual(['active', 'floors', 'id', 'name', 'unitCount']);
  });
});

describe('the lookups', () => {
  it('finds a block by id and by exact name', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db, 'Exact Name Court');

    const byId = await store.findBlockById(block.id);
    expect(byId).toEqual({ id: block.id, name: 'Exact Name Court', floors: 8, active: true });
    expect(await store.findBlockById(block.id + 100_000)).toBeNull();

    expect((await store.findBlockByName('Exact Name Court'))?.id).toBe(block.id);
    expect(await store.findBlockByName('EXACT NAME COURT')).toBeNull();
  });

  it('finds a home by unit id and by composite label', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id, { label: 'H-101', monthlyChargePaise: C.rupees(3000) });

    const home = await store.findHome(unit.id);
    expect(home?.blockId).toBe(block.id);
    expect(home?.monthlyChargePaise).toBe(C.rupees(3000));

    const byLabel = await store.findUnitByLabel(block.id, 'H-101');
    expect(byLabel?.unitId).toBe(unit.id);
    expect(await store.findUnitByLabel(block.id, 'H-102')).toBeNull();
  });

  it('counts only ACTIVE residents (the shared lookup, once more through this port)', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id);
    await aUser(db, { status: 'ACTIVE', unitId: unit.id });
    await aUser(db, { status: 'DISABLED', unitId: unit.id });

    expect(await store.countActiveResidentsForUnit(unit.id)).toBe(1);
  });
});

describe('createBlock', () => {
  it('creates the block, and a duplicate name is a null with nothing written', async () => {
    const store = propertyStore(db);
    const event = anEvent();

    const block = await store.createBlock({ name: 'New Court', floors: 4 }, [event]);
    expect(block?.id).toBeTypeOf('number');
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    const collision = await store.createBlock({ name: 'New Court', floors: 2 }, [anEvent()]);
    expect(collision).toBeNull();
    expect(await db.block.count({ where: { name: 'New Court' } })).toBe(1);
    expect(
      await db.outboxEvent.count({ where: { correlationId: `corr-${eventCounter}` } }),
    ).toBe(0);
  });
});

describe('createUnit', () => {
  it('creates the unit, and a duplicate label within the block is a null with nothing written', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db);
    const other = await aBlock(db);
    const event = anEvent();

    const unit = await store.createUnit(
      {
        blockId: block.id,
        label: 'U-1',
        type: 'FLAT_3BHK',
        monthlyChargePaise: C.rupees(4000),
      },
      [event],
    );
    expect(unit?.id).toBeTypeOf('number');
    expect((await store.findUnitByLabel(block.id, 'U-1'))?.type).toBe('FLAT_3BHK');

    const collision = await store.createUnit(
      { blockId: block.id, label: 'U-1', type: 'SHOP', monthlyChargePaise: C.paise(0) },
      [anEvent()],
    );
    expect(collision).toBeNull();
    expect(
      await db.outboxEvent.count({ where: { correlationId: `corr-${eventCounter}` } }),
    ).toBe(0);

    // The same label in a different block is a different unit — the natural key is the pair.
    const elsewhere = await store.createUnit(
      { blockId: other.id, label: 'U-1', type: 'SHOP', monthlyChargePaise: C.paise(0) },
      [],
    );
    expect(elsewhere).not.toBeNull();
    expect(await db.unit.count({ where: { label: 'U-1' } })).toBe(2);
  });
});

describe('updateUnit', () => {
  it('applies the patch and returns the unit with its block joined', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db, 'Patch Court');
    const unit = await aUnit(db, block.id, { label: 'P-1', monthlyChargePaise: C.rupees(1000) });
    const event = anEvent();

    const updated = await store.updateUnit(
      { unitId: unit.id, monthlyChargePaise: C.rupees(5000), type: 'FLAT_3BHK' },
      [event],
    );

    expect(updated?.blockName).toBe('Patch Court');
    expect(updated?.type).toBe('FLAT_3BHK');
    expect(updated?.monthlyChargePaise).toBe(C.rupees(5000));
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);
  });

  it('retires a unit without losing the charge, and an unknown unit is a null', async () => {
    const store = propertyStore(db);
    const block = await aBlock(db);
    const unit = await aUnit(db, block.id, { monthlyChargePaise: C.rupees(2000) });

    const retired = await store.updateUnit({ unitId: unit.id, active: false }, []);
    expect(retired?.active).toBe(false);
    expect(retired?.monthlyChargePaise).toBe(C.rupees(2000));

    expect(await store.updateUnit({ unitId: unit.id + 100_000, active: false }, [])).toBeNull();
  });
});
