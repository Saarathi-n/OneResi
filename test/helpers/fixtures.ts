import { rupees } from '@grihaone/contracts';
import type { Db } from '@grihaone/db';

/**
 * One fixture factory, shared by both database targets. The previous build had two divergent sets
 * of demo data — one in the mock store, one in the seed — that disagreed on unit types, complaint
 * statuses, payment methods, facility names and pass codes, so switching engines changed the data
 * underneath you (D-15).
 */

let counter = 0;
const unique = () => (counter += 1);

export async function aBlock(db: Db, name = `Block ${unique()}`) {
  return db.block.create({ data: { name, floors: 8 } });
}

export async function aUnit(
  db: Db,
  blockId: number,
  overrides: { label?: string; type?: string; monthlyChargePaise?: number } = {},
) {
  return db.unit.create({
    data: {
      blockId,
      label: overrides.label ?? `A-${100 + unique()}`,
      type: overrides.type ?? 'FLAT_2BHK',
      monthlyChargePaise: overrides.monthlyChargePaise ?? rupees(3500),
    },
  });
}

export async function aUser(
  db: Db,
  overrides: { role?: string; status?: string; unitId?: number; email?: string; name?: string } = {},
) {
  const n = unique();
  return db.residentUser.create({
    data: {
      name: overrides.name ?? `Person ${n}`,
      email: overrides.email ?? `person${n}@grihaone.test`,
      phone: `+9198765${String(10000 + n).slice(-5)}`,
      passwordHash: '$2b$12$notarealhashusedonlyinfixtures.....................',
      role: overrides.role ?? 'R',
      status: overrides.status ?? 'ACTIVE',
      ...(overrides.unitId === undefined ? {} : { unitId: overrides.unitId }),
    },
  });
}

export async function aFacility(db: Db, overrides: { name?: string } = {}) {
  return db.facility.create({
    data: {
      name: overrides.name ?? `Facility ${unique()}`,
      description: 'Bookable amenity.',
      opensAt: '06:00',
      closesAt: '22:00',
      hourlyRatePaise: rupees(150),
    },
  });
}

/** A calendar date at UTC midnight, so it means the same thing on both engines. */
export function onDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
