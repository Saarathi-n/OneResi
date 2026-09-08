import { describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import { propertyService } from './property.js';
import type {
  AdminBlockView,
  OutboxEventInput,
  PropertyStore,
  RegistrationOptionsBlock,
  StoredBlock,
  StoredHome,
} from './store.js';
import type { Actor, PropertyService, Result } from './ports.js';

/**
 * The property service, exercised against an in-memory store. The rules under test: what the
 * public list may reveal (labels, never charges), who may create the society's blocks and units
 * (the committee alone), what a duplicate natural key costs (a sentence, not a constraint name),
 * and what retiring a home requires (nobody left on it).
 */

// ---------------------------------------------------------------- fakes

interface BlockRow {
  id: number;
  name: string;
  floors: number;
  active: boolean;
}

interface UnitRow {
  unitId: number;
  blockId: number;
  label: string;
  type: C.UnitType;
  monthlyChargePaise: C.Paise;
  active: boolean;
}

/** A resident row is all occupancy needs: which unit, and still ACTIVE. */
interface ResidentRow {
  id: number;
  unitId: number;
  active: boolean;
}

/** An in-memory PropertyStore: the same contract the db package will implement, minus SQL. */
class MemoryPropertyStore implements PropertyStore {
  private nextBlockId = 1;
  private nextUnitId = 1;
  private nextResidentId = 1;
  readonly blocks: BlockRow[] = [];
  readonly units: UnitRow[] = [];
  readonly residents: ResidentRow[] = [];

  // ---- seeding, test-only

  seedBlock(name: string, options: { floors?: number; active?: boolean } = {}): number {
    const id = this.nextBlockId++;
    this.blocks.push({
      id,
      name,
      floors: options.floors ?? 1,
      active: options.active ?? true,
    });
    return id;
  }

  seedUnit(
    blockId: number,
    label: string,
    options: { type?: C.UnitType; chargePaise?: number; active?: boolean } = {},
  ): number {
    const unitId = this.nextUnitId++;
    this.units.push({
      unitId,
      blockId,
      label,
      type: options.type ?? 'FLAT_2BHK',
      monthlyChargePaise: C.paise(options.chargePaise ?? 250_000),
      active: options.active ?? true,
    });
    return unitId;
  }

  /** An ACTIVE resident on a unit — occupancy is counted, never stored as a flag (D-42). */
  seedResident(unitId: number, active = true): number {
    const id = this.nextResidentId++;
    this.residents.push({ id, unitId, active });
    return id;
  }

  // ---- lookups

  private homeFor(unit: UnitRow): StoredHome | null {
    const block = this.blocks.find((b) => b.id === unit.blockId);
    if (block === undefined) return null;
    return {
      unitId: unit.unitId,
      blockId: block.id,
      blockName: block.name,
      label: unit.label,
      type: unit.type,
      monthlyChargePaise: unit.monthlyChargePaise,
      active: unit.active,
    };
  }

  registrationOptions(): Promise<readonly RegistrationOptionsBlock[]> {
    return Promise.resolve(
      this.blocks
        .filter((b) => b.active)
        .map((b) => ({
          blockId: b.id,
          blockName: b.name,
          units: this.units
            .filter((u) => u.blockId === b.id && u.active)
            .map((u) => ({ unitId: u.unitId, label: u.label })),
        })),
    );
  }

  blocksForAdmin(): Promise<readonly AdminBlockView[]> {
    return Promise.resolve(
      this.blocks.map((b) => ({
        id: b.id,
        name: b.name,
        floors: b.floors,
        active: b.active,
        unitCount: this.units.filter((u) => u.blockId === b.id).length,
      })),
    );
  }

  findBlockById(id: number): Promise<StoredBlock | null> {
    const block = this.blocks.find((b) => b.id === id);
    return Promise.resolve(block === undefined ? null : { ...block });
  }

  findBlockByName(name: string): Promise<{ id: number } | null> {
    const block = this.blocks.find((b) => b.name === name);
    return Promise.resolve(block === undefined ? null : { id: block.id });
  }

  findUnitByLabel(blockId: number, label: string): Promise<StoredHome | null> {
    const unit = this.units.find((u) => u.blockId === blockId && u.label === label);
    return Promise.resolve(unit === undefined ? null : this.homeFor(unit));
  }

  findHome(unitId: number): Promise<StoredHome | null> {
    const unit = this.units.find((u) => u.unitId === unitId);
    return Promise.resolve(unit === undefined ? null : this.homeFor(unit));
  }

  countActiveResidentsForUnit(unitId: number): Promise<number> {
    return Promise.resolve(this.residents.filter((r) => r.unitId === unitId && r.active).length);
  }

  // ---- writes (each one is "a transaction" in the real store)

  createBlock(
    input: { name: string; floors: number },
    events: readonly OutboxEventInput[],
  ): Promise<{ id: number } | null> {
    if (this.blocks.some((b) => b.name === input.name)) return Promise.resolve(null);
    const id = this.nextBlockId++;
    this.blocks.push({ id, name: input.name, floors: input.floors, active: true });
    void events;
    return Promise.resolve({ id });
  }

  createUnit(
    input: {
      blockId: number;
      label: string;
      type: C.UnitType;
      monthlyChargePaise: C.Paise;
    },
    events: readonly OutboxEventInput[],
  ): Promise<{ id: number } | null> {
    if (this.units.some((u) => u.blockId === input.blockId && u.label === input.label)) {
      return Promise.resolve(null);
    }
    const unitId = this.nextUnitId++;
    this.units.push({
      unitId,
      blockId: input.blockId,
      label: input.label,
      type: input.type,
      monthlyChargePaise: input.monthlyChargePaise,
      active: true,
    });
    void events;
    return Promise.resolve({ id: unitId });
  }

  updateUnit(
    input: {
      unitId: number;
      type?: C.UnitType;
      monthlyChargePaise?: C.Paise;
      active?: boolean;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredHome | null> {
    const unit = this.units.find((u) => u.unitId === input.unitId);
    if (unit === undefined) return Promise.resolve(null);
    if (input.type !== undefined) unit.type = input.type;
    if (input.monthlyChargePaise !== undefined) unit.monthlyChargePaise = input.monthlyChargePaise;
    if (input.active !== undefined) unit.active = input.active;
    void events;
    return Promise.resolve(this.homeFor(unit));
  }
}

// ---------------------------------------------------------------- harness

interface Harness {
  service: PropertyService;
  store: MemoryPropertyStore;
}

function harness(): Harness {
  const store = new MemoryPropertyStore();
  return { service: propertyService({ store }), store };
}

const ADMIN: Actor = {
  userId: 1,
  name: 'Meera Committee',
  role: 'A',
  unitId: null,
  email: 'meera@example.com',
};

const RESIDENT: Actor = {
  userId: 2,
  name: 'Asha Rao',
  role: 'R',
  unitId: 1,
  email: 'asha@example.com',
};

const expectError = async <T>(
  result: Promise<Result<T>>,
  code: string,
): Promise<{ code: string; message: string; field?: string }> => {
  const settled = await result;
  if (settled.ok) throw new Error('expected a failure, got a value');
  expect(settled.error.code).toBe(code);
  return settled.error;
};

// ---------------------------------------------------------------- tests

describe('registrationOptions', () => {
  it('lists active blocks and their active units, labels only', async () => {
    const world = harness();
    const activeBlock = world.store.seedBlock('Brindavan');
    const retiredBlock = world.store.seedBlock('Old Wing', { active: false });
    world.store.seedUnit(activeBlock, 'B-101');
    world.store.seedUnit(activeBlock, 'B-102');
    world.store.seedUnit(activeBlock, 'B-103', { active: false });
    world.store.seedUnit(retiredBlock, 'O-001');

    const result = await world.service.registrationOptions();

    if (!result.ok) throw new Error('expected options');
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toEqual({
      blockId: activeBlock,
      blockName: 'Brindavan',
      units: [
        { unitId: expect.any(Number), label: 'B-101' },
        { unitId: expect.any(Number), label: 'B-102' },
      ],
    });
  });

  it('carries no charge anywhere in the public list (D-04)', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    world.store.seedUnit(blockId, 'B-101', { chargePaise: 400_000 });

    const result = await world.service.registrationOptions();

    if (!result.ok) throw new Error('expected options');
    // A charge that crossed this seam would appear here as a number.
    expect(JSON.stringify(result.value)).not.toContain('400000');
    expect(JSON.stringify(result.value)).not.toContain('harge');
  });
});

describe('blocks', () => {
  it('shows the committee every block, retired ones included, with unit counts', async () => {
    const world = harness();
    const blockA = world.store.seedBlock('Brindavan', { floors: 4 });
    const blockB = world.store.seedBlock('Old Wing', { active: false });
    world.store.seedUnit(blockA, 'B-101');
    world.store.seedUnit(blockA, 'B-102');
    world.store.seedUnit(blockB, 'O-001');

    const result = await world.service.blocks(ADMIN);

    if (!result.ok) throw new Error('expected blocks');
    expect(result.value).toEqual([
      { id: blockA, name: 'Brindavan', floors: 4, active: true, unitCount: 2 },
      { id: blockB, name: 'Old Wing', floors: 1, active: false, unitCount: 1 },
    ]);
  });

  it('refuses anyone but the committee', async () => {
    const world = harness();
    await expectError(world.service.blocks(RESIDENT), 'FORBIDDEN');
  });
});

describe('createBlock', () => {
  it('creates a block and returns its id', async () => {
    const world = harness();
    const input = C.CreateBlockInput.parse({ name: 'Brindavan', floors: 3 });

    const result = await world.service.createBlock(ADMIN, input);

    if (!result.ok) throw new Error('expected a block');
    expect(result.value.id).toBeGreaterThan(0);
    const stored = world.store.blocks.find((b) => b.id === result.value.id);
    expect(stored).toMatchObject({ name: 'Brindavan', floors: 3, active: true });
  });

  it('refuses a duplicate name — the block natural key (D-39)', async () => {
    const world = harness();
    world.store.seedBlock('Brindavan');
    const input = C.CreateBlockInput.parse({ name: 'Brindavan' });

    const error = await expectError(world.service.createBlock(ADMIN, input), 'CONFLICT');
    expect(error.field).toBe('name');
    expect(error.message).toBe('A block with that name already exists.');
  });

  it('refuses anyone but the committee', async () => {
    const world = harness();
    const input = C.CreateBlockInput.parse({ name: 'Brindavan' });
    await expectError(world.service.createBlock(RESIDENT, input), 'FORBIDDEN');
    expect(world.store.blocks).toHaveLength(0);
  });
});

describe('createUnit', () => {
  it('creates a unit in a block and returns its id', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const input = C.CreateUnitInput.parse({
      blockId,
      unitLabel: 'b-101',
      type: 'FLAT_3BHK',
      monthlyChargePaise: 350_000,
    });

    const result = await world.service.createUnit(ADMIN, input);

    if (!result.ok) throw new Error('expected a unit');
    const stored = world.store.units.find((u) => u.unitId === result.value.id);
    // UnitLabel uppercases on the way in — the natural key is the normalised label.
    expect(stored).toMatchObject({ blockId, label: 'B-101', type: 'FLAT_3BHK' });
    expect(stored?.monthlyChargePaise).toBe(C.paise(350_000));
  });

  it('refuses a label already used in that block, but not the same label in another block', async () => {
    const world = harness();
    const blockA = world.store.seedBlock('Brindavan');
    const blockB = world.store.seedBlock('Sampige');
    world.store.seedUnit(blockA, 'B-101');
    const duplicate = C.CreateUnitInput.parse({
      blockId: blockA,
      unitLabel: 'B-101',
      type: 'FLAT_2BHK',
      monthlyChargePaise: 250_000,
    });
    const elsewhere = C.CreateUnitInput.parse({
      blockId: blockB,
      unitLabel: 'B-101',
      type: 'FLAT_2BHK',
      monthlyChargePaise: 250_000,
    });

    const error = await expectError(world.service.createUnit(ADMIN, duplicate), 'CONFLICT');
    expect(error.field).toBe('unitLabel');
    expect(error.message).toBe('Unit B-101 already exists in that block.');

    const result = await world.service.createUnit(ADMIN, elsewhere);
    if (!result.ok) throw new Error('expected a unit in the other block');
    expect(result.value.id).toBeGreaterThan(0);
  });

  it('refuses a unit in a block that does not exist, and in a retired block', async () => {
    const world = harness();
    const retired = world.store.seedBlock('Old Wing', { active: false });
    const missing = C.CreateUnitInput.parse({
      blockId: 999,
      unitLabel: 'X-001',
      type: 'SHOP',
      monthlyChargePaise: 100_000,
    });
    const retiredInput = C.CreateUnitInput.parse({
      blockId: retired,
      unitLabel: 'O-002',
      type: 'SHOP',
      monthlyChargePaise: 100_000,
    });

    await expectError(world.service.createUnit(ADMIN, missing), 'NOT_FOUND');
    await expectError(world.service.createUnit(ADMIN, retiredInput), 'NOT_FOUND');
  });

  it('refuses anyone but the committee', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const input = C.CreateUnitInput.parse({
      blockId,
      unitLabel: 'B-101',
      type: 'FLAT_2BHK',
      monthlyChargePaise: 250_000,
    });
    await expectError(world.service.createUnit(RESIDENT, input), 'FORBIDDEN');
    expect(world.store.units).toHaveLength(0);
  });
});

describe('updateUnit', () => {
  it('changes type and charge together', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const unitId = world.store.seedUnit(blockId, 'B-101');
    const input = C.UpdateUnitInput.parse({ unitId, type: 'FLAT_4BHK', monthlyChargePaise: 500_000 });

    const result = await world.service.updateUnit(ADMIN, input);

    expect(result.ok).toBe(true);
    expect(world.store.units.find((u) => u.unitId === unitId)).toMatchObject({
      type: 'FLAT_4BHK',
      monthlyChargePaise: C.paise(500_000),
      active: true,
    });
  });

  it('refuses to retire a home that still has residents (D-42)', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const unitId = world.store.seedUnit(blockId, 'B-101');
    world.store.seedResident(unitId);
    const input = C.UpdateUnitInput.parse({ unitId, active: false });

    const error = await expectError(world.service.updateUnit(ADMIN, input), 'CONFLICT');
    expect(error.message).toBe('That home still has residents; rehouse them before retiring it.');
    expect(world.store.units.find((u) => u.unitId === unitId)?.active).toBe(true);
  });

  it('retires a home once the last resident has gone, and brings one back', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const unitId = world.store.seedUnit(blockId, 'B-101');
    const residentId = world.store.seedResident(unitId);

    // Rehoused: the resident's row no longer points here.
    const resident = world.store.residents.find((r) => r.id === residentId);
    if (resident === undefined) throw new Error('seeded resident is missing');
    resident.unitId = unitId + 100;
    expect(
      await world.service.updateUnit(ADMIN, C.UpdateUnitInput.parse({ unitId, active: false })),
    ).toMatchObject({ ok: true });
    expect(world.store.units.find((u) => u.unitId === unitId)?.active).toBe(false);

    // And the committee can bring a home back.
    expect(
      await world.service.updateUnit(ADMIN, C.UpdateUnitInput.parse({ unitId, active: true })),
    ).toMatchObject({ ok: true });
    expect(world.store.units.find((u) => u.unitId === unitId)?.active).toBe(true);
  });

  it('leaves a retired home alone rather than re-checking its residents', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const unitId = world.store.seedUnit(blockId, 'B-101', { active: false });
    world.store.seedResident(unitId);
    // active: false on an already-retired unit is a no-op patch, not a retirement.
    const input = C.UpdateUnitInput.parse({ unitId, active: false });

    const result = await world.service.updateUnit(ADMIN, input);

    expect(result.ok).toBe(true);
  });

  it('refuses an unknown unit, and anyone but the committee', async () => {
    const world = harness();
    const blockId = world.store.seedBlock('Brindavan');
    const unitId = world.store.seedUnit(blockId, 'B-101');

    await expectError(
      world.service.updateUnit(ADMIN, C.UpdateUnitInput.parse({ unitId: 999, active: false })),
      'NOT_FOUND',
    );
    await expectError(
      world.service.updateUnit(RESIDENT, C.UpdateUnitInput.parse({ unitId, active: false })),
      'FORBIDDEN',
    );
  });
});
