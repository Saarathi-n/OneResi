import type * as C from '@grihaone/contracts';
import type { Db, Prisma } from '../client.js';
import type { VisitorStore } from '@grihaone/domain';
import {
  findPassIn,
  isUniqueViolation,
  passInclude,
  sharedLookups,
  toHome,
  toLog,
  toPass,
  unitInclude,
  writeEvents,
} from './shared.js';

/**
 * VisitorStore over Prisma: the passes a household issues, the gate's check-in and check-out,
 * and the walk-in queue. The joined reads (`createdByName`, `enteredAt`, `exitedAt`) come from
 * Prisma includes, so a list of passes is one query with its joins, never one query per pass.
 */
export function visitorStore(db: Db): VisitorStore {
  const store: VisitorStore = {
    ...sharedLookups(db),

    async findPassByCode(code) {
      const row = await db.visitorPass.findUnique({ where: { code }, include: passInclude });
      return row === null ? null : toPass(row);
    },

    async findPassById(id) {
      const row = await db.visitorPass.findUnique({ where: { id }, include: passInclude });
      return row === null ? null : toPass(row);
    },

    async findPassesForUnit(unitId, filter) {
      // The filter is an argument, never a fall-through: an absent field means "not narrowed".
      const where: Prisma.VisitorPassWhereInput = {
        unitId,
        ...(filter.validOn === undefined ? {} : { validOn: filter.validOn }),
        ...(filter.statuses === undefined ? {} : { status: { in: [...filter.statuses] } }),
      };
      const rows = await db.visitorPass.findMany({
        where,
        include: passInclude,
        orderBy: [{ validOn: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toPass);
    },

    async createPass(input, events) {
      try {
        return await db.$transaction(async (tx) => {
          const created = await tx.visitorPass.create({
            data: {
              unitId: input.unitId,
              createdById: input.createdById,
              visitorName: input.visitorName,
              purpose: input.purpose,
              code: input.code,
              validOn: input.validOn,
              createdAt: input.createdAt,
            },
          });
          await writeEvents(tx, events);
          const joined = await tx.visitorPass.findUniqueOrThrow({
            where: { id: created.id },
            include: passInclude,
          });
          return toPass(joined);
        });
      } catch (error) {
        // Six digits collide eventually. A taken code is not a failure — the caller answers it
        // with a fresh code. The transaction rolled back, so no pass row and no event row.
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async cancelPass(id, cancelledAt, events) {
      return db.$transaction(async (tx) => {
        // One guarded write takes both the status and the timestamp, so they cannot disagree.
        const applied = await tx.visitorPass.updateMany({
          where: { id, status: 'ACTIVE' },
          data: { status: 'CANCELLED', cancelledAt },
        });
        if (applied.count === 0) return null;
        await writeEvents(tx, events);
        const joined = await findPassIn(tx, id);
        return joined === null ? null : toPass(joined);
      });
    },

    async checkInPass(input, log, events) {
      return db.$transaction(async (tx) => {
        // Exact-once for gate retries: the key is unique on the log, so a key already in the
        // table means this check-in landed before. Acknowledge it by returning the pass as it
        // now stands — the same answer the first attempt gave, with nothing touched. A key that
        // belongs to a DIFFERENT pass is a caller bug, and it surfaces loudly: the insert below
        // meets the unique index and rolls the whole transaction back.
        if (input.idempotencyKey !== null) {
          const seen = await tx.visitorLog.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { passId: true },
          });
          if (seen !== null && seen.passId === input.passId) {
            const replayed = await findPassIn(tx, input.passId);
            if (replayed === null) return null;
            return toPass(replayed);
          }
        }

        // The guarded ACTIVE -> USED transition: a second check-in without a key cannot find an
        // ACTIVE pass to take, which is the idempotency when no key is supplied (D-40).
        const applied = await tx.visitorPass.updateMany({
          where: { id: input.passId, status: 'ACTIVE' },
          data: { status: 'USED' },
        });
        if (applied.count === 0) return null;

        await tx.visitorLog.create({
          data: {
            passId: log.passId,
            unitId: log.unitId,
            walkInName: log.walkInName,
            walkInPhone: log.walkInPhone,
            walkInPurpose: log.walkInPurpose,
            approvalStatus: log.approvalStatus,
            decidedById: log.decidedById,
            decidedAt: log.decidedAt,
            overrideReason: log.overrideReason,
            enteredAt: log.enteredAt,
            idempotencyKey: input.idempotencyKey,
            createdAt: log.createdAt,
          },
        });
        await writeEvents(tx, events);

        const joined = await findPassIn(tx, input.passId);
        return joined === null ? null : toPass(joined);
      });
    },

    async checkOutPass(passId, at) {
      return db.$transaction(async (tx) => {
        // The open log row: entered but not yet exited. Latest first, though a pass has at most
        // one row in practice — the ACTIVE guard at check-in sees to that.
        const open = await tx.visitorLog.findMany({
          where: { passId, exitedAt: null, enteredAt: { not: null } },
          orderBy: { id: 'desc' },
          take: 1,
        });
        const row = open[0];
        if (row === undefined) return null;

        // Conditional stamp, so two concurrent check-outs cannot both close the row.
        const applied = await tx.visitorLog.updateMany({
          where: { id: row.id, exitedAt: null },
          data: { exitedAt: at },
        });
        if (applied.count === 0) return null;

        const closed = await tx.visitorLog.findUniqueOrThrow({ where: { id: row.id } });
        return toLog(closed);
      });
    },

    async stampWalkInEntry(input, events) {
      return db.$transaction(async (tx) => {
        // The guarded stamp: only an APPROVED walk-in with no entry yet moves, so two concurrent
        // confirmations cannot both write, and an unanswered visit records nothing.
        const applied = await tx.visitorLog.updateMany({
          where: { id: input.logId, approvalStatus: 'APPROVED', enteredAt: null },
          data: { enteredAt: input.at },
        });
        if (applied.count === 0) return null;

        await writeEvents(tx, events);
        const stamped = await tx.visitorLog.findUniqueOrThrow({ where: { id: input.logId } });
        return toLog(stamped);
      });
    },

    async stampWalkInExit(logId, at) {
      return db.$transaction(async (tx) => {
        // The same conditional stamp checkOutPass keeps: an open entry closes exactly once.
        const applied = await tx.visitorLog.updateMany({
          where: { id: logId, enteredAt: { not: null }, exitedAt: null },
          data: { exitedAt: at },
        });
        if (applied.count === 0) return null;

        const closed = await tx.visitorLog.findUniqueOrThrow({ where: { id: logId } });
        return toLog(closed);
      });
    },

    async createWalkInLog(input, events) {
      return db.$transaction(async (tx) => {
        const row = await tx.visitorLog.create({
          data: {
            passId: input.passId,
            unitId: input.unitId,
            walkInName: input.walkInName,
            walkInPhone: input.walkInPhone,
            walkInPurpose: input.walkInPurpose,
            approvalStatus: input.approvalStatus,
            decidedById: input.decidedById,
            decidedAt: input.decidedAt,
            overrideReason: input.overrideReason,
            enteredAt: input.enteredAt,
            createdAt: input.createdAt,
          },
        });
        await writeEvents(tx, events);
        return toLog(row);
      });
    },

    async findLogById(id) {
      const row = await db.visitorLog.findUnique({ where: { id } });
      return row === null ? null : toLog(row);
    },

    async findPendingWalkIns(unitId) {
      // The queue a resident answers: this household's undecided walk-ins, oldest first.
      const rows = await db.visitorLog.findMany({
        where: { unitId, approvalStatus: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toLog);
    },

    async findPendingWalkInsForSociety() {
      // The kiosk's queue: the same rows without the household filter, each joined to its home so
      // the gate can say which flat a visitor waits on — and, once the household has answered,
      // record the arrival its approval set in motion. Walk-in rows only: a pass's own log row
      // enters with its check-in. A visit leaves when it is turned away or closed with an exit.
      const rows = await db.visitorLog.findMany({
        where: {
          passId: null,
          OR: [{ approvalStatus: 'PENDING' }, { approvalStatus: 'APPROVED', exitedAt: null }],
        },
        include: { unit: { include: unitInclude } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({ ...toLog(row), home: toHome(row.unit) }));
    },

    async findLogsForUnit(unitId, limit) {
      // The feed: newest first, joined so a pass entry names its visitor from the pass and a
      // walk-in's decision names the person who made it. One query with its joins.
      const rows = await db.visitorLog.findMany({
        where: { unitId },
        include: {
          pass: { select: { visitorName: true, purpose: true } },
          decidedBy: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.map((row) => ({
        logId: row.id,
        kind: row.passId === null ? ('WALK_IN' as const) : ('PASS' as const),
        visitorName: row.walkInName ?? row.pass?.visitorName ?? '',
        purpose: row.walkInPurpose ?? row.pass?.purpose ?? '',
        approvalStatus: row.approvalStatus as C.ApprovalStatus,
        decidedByName: row.decidedBy?.name ?? null,
        overrideReason: row.overrideReason,
        enteredAt: row.enteredAt,
        exitedAt: row.exitedAt,
        createdAt: row.createdAt,
      }));
    },

    async findLogsForSociety(limit) {
      // The society's whole gate log, newest first, with the same joins the household feed keeps
      // plus the home — one query for the visitors report and the dashboard's traffic figure.
      const rows = await db.visitorLog.findMany({
        include: {
          pass: { select: { visitorName: true, purpose: true } },
          decidedBy: { select: { name: true } },
          unit: { include: { block: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.map((row) => ({
        logId: row.id,
        kind: row.passId === null ? ('WALK_IN' as const) : ('PASS' as const),
        visitorName: row.walkInName ?? row.pass?.visitorName ?? '',
        purpose: row.walkInPurpose ?? row.pass?.purpose ?? '',
        approvalStatus: row.approvalStatus as C.ApprovalStatus,
        decidedByName: row.decidedBy?.name ?? null,
        overrideReason: row.overrideReason,
        enteredAt: row.enteredAt,
        exitedAt: row.exitedAt,
        createdAt: row.createdAt,
        home: {
          unitId: row.unit.id,
          blockId: row.unit.blockId,
          blockName: row.unit.block.name,
          label: row.unit.label,
          type: row.unit.type as C.UnitType,
          monthlyChargePaise: row.unit.monthlyChargePaise as C.Paise,
          active: row.unit.active,
        },
      }));
    },

    async decideWalkInLog(input, events) {
      return db.$transaction(async (tx) => {
        // A decision is a guarded transition, not an assignment: only a PENDING visit moves.
        const applied = await tx.visitorLog.updateMany({
          where: { id: input.logId, approvalStatus: 'PENDING' },
          data: {
            approvalStatus: input.approvalStatus,
            decidedById: input.decidedById,
            decidedAt: input.decidedAt,
          },
        });
        if (applied.count === 0) return null;

        await writeEvents(tx, events);
        const decided = await tx.visitorLog.findUniqueOrThrow({ where: { id: input.logId } });
        return toLog(decided);
      });
    },
  };

  return store;
}
