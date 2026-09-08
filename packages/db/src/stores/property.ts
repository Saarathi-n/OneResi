import type { Db } from '../client.js';
import type { PropertyStore } from '@oneresi/domain';
import {
  isRecordMissing,
  isUniqueViolation,
  sharedLookups,
  toBlock,
  toHome,
  unitInclude,
  writeEvents,
} from './shared.js';

/**
 * PropertyStore over Prisma: the public registration list, the committee's register, and the
 * guarded natural-key creations. Duplicate names and labels are answered as null — the unique
 * constraints decide, not a check-then-insert a concurrent request can slip past.
 */
export function propertyStore(db: Db): PropertyStore {
  const store: PropertyStore = {
    ...sharedLookups(db),

    async registrationOptions() {
      // The only public surface: active blocks with their active units, labels only. No charge
      // and no occupant crosses this seam (D-04) — the projection cannot even select them.
      const rows = await db.block.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          units: {
            where: { active: true },
            orderBy: { label: 'asc' },
            select: { id: true, label: true },
          },
        },
      });
      return rows.map((block) => ({
        blockId: block.id,
        blockName: block.name,
        units: block.units.map((unit) => ({ unitId: unit.id, label: unit.label })),
      }));
    },

    async blocksForAdmin() {
      // The committee's list: every block, retired ones included, with a unit count.
      const rows = await db.block.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { units: true } } },
      });
      return rows.map((block) => ({
        id: block.id,
        name: block.name,
        floors: block.floors,
        active: block.active,
        unitCount: block._count.units,
      }));
    },

    async findBlockById(id) {
      const row = await db.block.findUnique({ where: { id } });
      return row === null ? null : toBlock(row);
    },

    async createBlock(input, events) {
      try {
        return await db.$transaction(async (tx) => {
          const block = await tx.block.create({
            data: { name: input.name, floors: input.floors },
          });
          await writeEvents(tx, events);
          return { id: block.id };
        });
      } catch (error) {
        // Block.name is unique: the name is taken. The transaction rolled back — no row, no events.
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async createUnit(input, events) {
      try {
        return await db.$transaction(async (tx) => {
          const unit = await tx.unit.create({
            data: {
              blockId: input.blockId,
              label: input.label,
              type: input.type,
              monthlyChargePaise: input.monthlyChargePaise,
            },
          });
          await writeEvents(tx, events);
          return { id: unit.id };
        });
      } catch (error) {
        // (blockId, label) is the natural key: the label is taken within that block.
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async updateUnit(input, events) {
      try {
        return await db.$transaction(async (tx) => {
          const updated = await tx.unit.update({
            where: { id: input.unitId },
            data: {
              ...(input.type === undefined ? {} : { type: input.type }),
              ...(input.monthlyChargePaise === undefined
                ? {}
                : { monthlyChargePaise: input.monthlyChargePaise }),
              ...(input.active === undefined ? {} : { active: input.active }),
            },
          });
          await writeEvents(tx, events);
          const joined = await tx.unit.findUniqueOrThrow({
            where: { id: updated.id },
            include: unitInclude,
          });
          return toHome(joined);
        });
      } catch (error) {
        // An unknown unit is a null, not an error — the service maps it to its own words.
        if (isRecordMissing(error)) return null;
        throw error;
      }
    },
  };

  return store;
}
