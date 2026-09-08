import * as C from '@oneresi/contracts';
import type { Db } from '../client.js';
import type { ComplaintStore } from '@oneresi/domain';
import {
  complaintInclude,
  sharedLookups,
  toComplaint,
  toUpdate,
  writeEvents,
} from './shared.js';

/**
 * ComplaintStore over Prisma: the household's complaints, the committee desk, and the state
 * machine that governs them. `resolvedAt` is set on entering RESOLVED and survives every later
 * update except an explicit reopen — the seven-day reopen window is measured from it (D-20).
 */
export function complaintStore(db: Db): ComplaintStore {
  const store: ComplaintStore = {
    ...sharedLookups(db),

    async findComplaintById(id) {
      const row = await db.complaint.findUnique({ where: { id }, include: complaintInclude });
      return row === null ? null : toComplaint(row, row.updates.map(toUpdate));
    },

    async findComplaintsForUnit(unitId) {
      const rows = await db.complaint.findMany({
        where: { unitId },
        include: complaintInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map((row) => toComplaint(row, row.updates.map(toUpdate)));
    },

    async findComplaintsForSociety(filter) {
      const rows = await db.complaint.findMany({
        // An absent status means "not narrowed" — the filter is an argument, never a fall-through.
        where: filter.status === undefined ? {} : { status: filter.status },
        include: complaintInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map((row) => toComplaint(row, row.updates.map(toUpdate)));
    },

    async createComplaint(input, eventsFor) {
      return db.$transaction(async (tx) => {
        const row = await tx.complaint.create({
          data: {
            unitId: input.unitId,
            category: input.category,
            priority: input.priority,
            description: input.description,
            // One column, newline separated, exactly as the submitted model specifies. The keys
            // are opaque here — a presigned upload produced them.
            photoKeys: input.photoKeys.join('\n'),
            createdAt: input.raisedAt,
          },
        });
        const complaint = toComplaint(row, []);
        await writeEvents(tx, eventsFor(complaint));
        return complaint;
      });
    },

    async applyComplaintUpdate(input, events) {
      return db.$transaction(async (tx) => {
        const current = await tx.complaint.findUnique({
          where: { id: input.complaintId },
          select: { status: true },
        });
        if (current === null) return null;

        // The store applies only a transition the contract's state machine permits from the
        // CURRENT status — the caller validated against a snapshot, and the world may have
        // moved since (D-20).
        const from = current.status as C.ComplaintStatus;
        if (!C.COMPLAINT_TRANSITIONS[from].includes(input.statusAfter)) return null;

        // Entering RESOLVED stamps the resolution; a RESOLVED -> OPEN move is a reopen whoever
        // made it — the timestamp clears and the counter advances. Nothing else touches either.
        const applied = await tx.complaint.updateMany({
          where: { id: input.complaintId, status: current.status },
          data: {
            status: input.statusAfter,
            ...(input.statusAfter === 'RESOLVED' ? { resolvedAt: input.at } : {}),
            ...(from === 'RESOLVED' && input.statusAfter === 'OPEN'
              ? { resolvedAt: null, reopenCount: { increment: 1 } }
              : {}),
          },
        });
        if (applied.count === 0) return null;

        await tx.complaintUpdate.create({
          data: {
            complaintId: input.complaintId,
            updatedById: input.updatedById,
            statusAfter: input.statusAfter,
            note: input.note,
            createdAt: input.at,
          },
        });
        await writeEvents(tx, events);

        const row = await tx.complaint.findUniqueOrThrow({
          where: { id: input.complaintId },
          include: complaintInclude,
        });
        return toComplaint(row, row.updates.map(toUpdate));
      });
    },

    async reopenComplaint(input, events) {
      return db.$transaction(async (tx) => {
        // Only a resolved complaint can be reopened — the guard, not an assignment.
        const applied = await tx.complaint.updateMany({
          where: { id: input.complaintId, status: 'RESOLVED' },
          data: { status: 'OPEN', resolvedAt: null, reopenCount: { increment: 1 } },
        });
        if (applied.count === 0) return null;

        // The resident's reason, recorded as an attributed update row like every other change.
        await tx.complaintUpdate.create({
          data: {
            complaintId: input.complaintId,
            updatedById: input.reopenedById,
            statusAfter: 'OPEN',
            note: input.reason,
            createdAt: input.at,
          },
        });
        await writeEvents(tx, events);

        const row = await tx.complaint.findUniqueOrThrow({
          where: { id: input.complaintId },
          include: complaintInclude,
        });
        return toComplaint(row, row.updates.map(toUpdate));
      });
    },
  };

  return store;
}
