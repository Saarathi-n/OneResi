import * as C from '@oneresi/contracts';
import { ok } from './ports.js';
import type { Actor, PropertyService, Result } from './ports.js';
import { errors } from './errors.js';
import type { PropertyStore } from './store.js';

/**
 * Property: the blocks and units a society is made of, and the one list the public may see.
 *
 * Design consequences, each closing a defect from the register:
 *
 *  - the registration list carries labels only — no charge, no occupant count crosses that seam,
 *    because an applicant must never see or set either (D-04)
 *  - blocks and units are named by their natural keys (block name, block + label); a duplicate is
 *    a CONFLICT with a sentence in it, not a raw constraint name in the browser (D-39)
 *  - creating blocks and units is the committee's alone; an applicant who wants a home that is
 *    not on the list describes a claim and waits for a decision (D-04)
 *  - a unit is retired only when nobody lives on it — occupancy is a count of ACTIVE residents,
 *    so retiring a home can never strand a person on a bill (D-42)
 */

export interface PropertyDeps {
  readonly store: PropertyStore;
}

export function propertyService(deps: PropertyDeps): PropertyService {
  const { store } = deps;

  /** The committee's register. Every mutation below passes through this gate. */
  const committeeGate = (actor: Actor): Result<never> | null =>
    actor.role === 'A' ? null : errors.forbidden('manage the property register');

  return {
    async registrationOptions() {
      return ok(await store.registrationOptions());
    },

    async blocks(actor) {
      const denied = committeeGate(actor);
      if (denied !== null) return denied;
      return ok(await store.blocksForAdmin());
    },

    async createBlock(actor, input): Promise<Result<{ id: number }>> {
      const denied = committeeGate(actor);
      if (denied !== null) return denied;

      if ((await store.findBlockByName(input.name)) !== null) {
        return errors.conflict('A block with that name already exists.', 'name');
      }
      const created = await store.createBlock(
        { name: input.name, floors: input.floors },
        // No outbox vocabulary exists for property changes; the seam keeps its shape (D-29).
        [],
      );
      // Taken between the check and the insert — the natural key answered, not the caller's fault.
      if (created === null) {
        return errors.conflict('A block with that name already exists.', 'name');
      }
      return ok(created);
    },

    async createUnit(actor, input): Promise<Result<{ id: number }>> {
      const denied = committeeGate(actor);
      if (denied !== null) return denied;

      const block = await store.findBlockById(input.blockId);
      if (block === null || !block.active) return errors.notFound('block');
      if ((await store.findUnitByLabel(input.blockId, input.unitLabel)) !== null) {
        return errors.conflict(`Unit ${input.unitLabel} already exists in that block.`, 'unitLabel');
      }
      const created = await store.createUnit(
        {
          blockId: input.blockId,
          label: input.unitLabel,
          type: input.type,
          // The wire carries a plain number; the paise brand is applied at this seam, once.
          monthlyChargePaise: C.paise(input.monthlyChargePaise),
        },
        [],
      );
      if (created === null) {
        return errors.conflict(`Unit ${input.unitLabel} already exists in that block.`, 'unitLabel');
      }
      return ok(created);
    },

    async updateUnit(actor, input): Promise<Result<null>> {
      const denied = committeeGate(actor);
      if (denied !== null) return denied;

      const unit = await store.findHome(input.unitId);
      if (unit === null) return errors.notFound('unit');

      if (input.active === false && unit.active) {
        // Retiring a home somebody still lives on would strand them on a bill forever (D-42).
        const residents = await store.countActiveResidentsForUnit(input.unitId);
        if (residents > 0) {
          return errors.conflict('That home still has residents; rehouse them before retiring it.');
        }
      }

      const updated = await store.updateUnit(
        {
          unitId: input.unitId,
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.monthlyChargePaise === undefined
            ? {}
            : { monthlyChargePaise: C.paise(input.monthlyChargePaise) }),
          ...(input.active === undefined ? {} : { active: input.active }),
        },
        [],
      );
      if (updated === null) return errors.notFound('unit');
      return ok(null);
    },
  };
}
