import type * as C from '@oneresi/contracts';
import type {
  Block,
  Complaint,
  Facility,
  Invoice,
  Notification,
  Payment,
  PushSubscription,
  ResidentUser,
  VisitorLog,
} from '../../prisma/generated/postgresql/index.js';
import type { Db, Prisma } from '../client.js';
import { announceEvents } from '../events.js';
import type {
  OutboxEventInput,
  StoredAccount,
  StoredAnnouncement,
  StoredBlock,
  StoredBooking,
  StoredComplaint,
  StoredComplaintUpdate,
  StoredFacility,
  StoredHome,
  StoredInvoice,
  StoredNotification,
  StoredPayment,
  StoredPushSubscription,
  StoredVisitorLog,
  StoredVisitorPass,
} from '@oneresi/domain';

/**
 * The Prisma implementations of the domain's store ports (`packages/domain/src/store.ts`).
 *
 * Everything here answers one question per method: does this query do what its port claims, on
 * SQLite AND on PostgreSQL? The factories return objects annotated with the port interface, so a
 * field mismatch is a compile error — that is the whole reason `packages/db` depends on
 * `@oneresi/domain` instead of the other way round.
 *
 * Conventions the whole module keeps:
 *
 *  - a change and the outbox events that accompany it are written in ONE `db.$transaction`
 *    (D-29); there is no code path where a domain write commits and its mail does not
 *  - a guarded transition (`updateMany` with the expected current state in the `where`) returns
 *    null when the world changed underneath the caller — never an assignment, never an error
 *  - natural-key collisions are caught by unique-constraint code P2002 and reported as null;
 *    the catch sits OUTSIDE the transaction so the engine rolls the whole thing back
 *  - text matches are exact. `mode: 'insensitive'` is PostgreSQL-only and the mail package
 *    already established exact-match as the convention (D-15: "works locally, breaks in the
 *    cloud" starts as a per-engine convenience)
 */

/** A transaction. Every mutating port method runs inside one of these. */
export type Tx = Prisma.TransactionClient;

/** The unit with its block, which is what every `StoredHome` read joins to. */
const UNIT_INCLUDE = { block: true } satisfies Prisma.UnitInclude;
export type UnitRow = Prisma.UnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

/**
 * The pass with the two joins `StoredVisitorPass` promises: the creator's name, and the latest
 * log row — so a list of passes costs one query, not one query per pass (the port's own rule).
 */
const PASS_INCLUDE = {
  createdBy: { select: { name: true } },
  logs: { orderBy: { id: 'desc' }, take: 1, select: { enteredAt: true, exitedAt: true } },
} satisfies Prisma.VisitorPassInclude;
export type PassRow = Prisma.VisitorPassGetPayload<{ include: typeof PASS_INCLUDE }>;

/**
 * The invoice with the settlement its status claims. At most one payment exists — settlement is
 * in full and the payable guard refuses a second row (D-26) — so `take: 1` is the join, not a
 * truncation.
 */
const INVOICE_INCLUDE = {
  payments: { orderBy: { id: 'asc' }, take: 1 },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

/** The booking with the facility name `StoredBooking` promises, joined. */
const BOOKING_INCLUDE = { facility: { select: { name: true } } } satisfies Prisma.BookingInclude;
export type BookingRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

/** The announcement with its author's name, joined (UC-24). */
const ANNOUNCEMENT_INCLUDE = {
  author: { select: { name: true } },
} satisfies Prisma.AnnouncementInclude;
export type AnnouncementRow = Prisma.AnnouncementGetPayload<{ include: typeof ANNOUNCEMENT_INCLUDE }>;

/** A complaint's attributed update, with the acting identity's name joined (UC-20 step 3). */
const COMPLAINT_UPDATE_INCLUDE = {
  updatedBy: { select: { name: true } },
} satisfies Prisma.ComplaintUpdateInclude;
export type ComplaintUpdateRow = Prisma.ComplaintUpdateGetPayload<{
  include: typeof COMPLAINT_UPDATE_INCLUDE;
}>;

/** The complaint with its update trail, oldest first — the history a household reads in full. */
const COMPLAINT_INCLUDE = {
  updates: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: COMPLAINT_UPDATE_INCLUDE },
} satisfies Prisma.ComplaintInclude;
export type ComplaintRow = Prisma.ComplaintGetPayload<{ include: typeof COMPLAINT_INCLUDE }>;

/** Prisma's unique-constraint violation, identical on both engines. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'P2002';
}

/** Prisma's "record not found" from an update against an id that is not there. */
export function isRecordMissing(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'P2025';
}

/**
 * The hours a booking window touches: `10:30–11:15` is hour 10 only, `10:00–12:00` is hours 10
 * and 11 (the end is exclusive). Any two overlapping ranges share at least one hour of the day,
 * which is what makes one hold row per touched hour the collision rule (D-81). Shared by the
 * store's create and the seed, so a seeded booking holds its hours exactly like a made one.
 */
export function hoursTouched(input: {
  readonly startTime: string;
  readonly endTime: string;
}): number[] {
  const minutesOf = (clockTime: string): number =>
    Number(clockTime.slice(0, 2)) * 60 + Number(clockTime.slice(3, 5));
  const first = Math.floor(minutesOf(input.startTime) / 60);
  const last = Math.floor((minutesOf(input.endTime) - 1) / 60);
  const hours: number[] = [];
  for (let hour = first; hour <= last; hour += 1) hours.push(hour);
  return hours;
}

/**
 * The outbox half of every mutation. Payloads are flat scalars by port contract, so
 * `JSON.stringify` is engine-proof; the row is born PENDING and the worker takes it from there.
 */
export async function writeEvents(
  tx: Tx,
  events: readonly OutboxEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.outboxEvent.createMany({
    data: events.map((event) => ({
      type: event.type,
      channel: event.channel,
      payload: JSON.stringify(event.payload),
      correlationId: event.correlationId,
    })),
  });
  // On AWS this is the tap that wakes the notifier Lambda (EVENT_DRIVER=sns); locally it is a
  // no-op and the in-process timers drain instead. Announced inside the callback — see the
  // function's own comment for why that is the safe direction to be wrong in.
  await announceEvents(events);
}

// ---------------------------------------------------------------- mappers

/** A `StoredAccount`. The password hash crosses this seam only where the port says it does. */
export function toAccount(row: ResidentUser): StoredAccount {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    passwordHash: row.passwordHash,
    role: row.role as C.Role,
    status: row.status as C.UserStatus,
    unitId: row.unitId,
    passwordChangedAt: row.passwordChangedAt,
    resetTokenHash: row.resetTokenHash,
    resetExpiresAt: row.resetExpiresAt,
  };
}

export function toHome(row: UnitRow): StoredHome {
  return {
    unitId: row.id,
    blockId: row.blockId,
    blockName: row.block.name,
    label: row.label,
    type: row.type as C.UnitType,
    monthlyChargePaise: row.monthlyChargePaise as C.Paise,
    active: row.active,
  };
}

export function toPass(row: PassRow): StoredVisitorPass {
  // The latest log row carries enteredAt/exitedAt; a pass nobody checked in has none at all.
  const latest = row.logs[0];
  return {
    id: row.id,
    unitId: row.unitId,
    createdById: row.createdById,
    createdByName: row.createdBy.name,
    visitorName: row.visitorName,
    purpose: row.purpose,
    code: row.code,
    validOn: row.validOn,
    status: row.status as C.PassStatus,
    createdAt: row.createdAt,
    enteredAt: latest?.enteredAt ?? null,
    exitedAt: latest?.exitedAt ?? null,
  };
}

export function toLog(row: VisitorLog): StoredVisitorLog {
  return {
    id: row.id,
    passId: row.passId,
    unitId: row.unitId,
    walkInName: row.walkInName,
    walkInPhone: row.walkInPhone,
    walkInPurpose: row.walkInPurpose,
    approvalStatus: row.approvalStatus as C.ApprovalStatus,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt,
    overrideReason: row.overrideReason,
    enteredAt: row.enteredAt,
    exitedAt: row.exitedAt,
    createdAt: row.createdAt,
  };
}

export function toBlock(row: Block): StoredBlock {
  return { id: row.id, name: row.name, floors: row.floors, active: row.active };
}

// ------------------------------------------------- billing, complaints, facilities,
//                                                   notices, notifications

export function toPayment(row: Payment): StoredPayment {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    recordedById: row.recordedById,
    amountPaise: row.amountPaise as C.Paise,
    method: row.method as C.PaymentMethod,
    receiptNo: row.receiptNo,
    reference: row.reference,
    paidAt: row.paidAt,
  };
}

/**
 * The invoice with its settlement joined in. The payment is a parameter, not an include, so the
 * create path (which knows there is none yet) and the read path share one mapping.
 */
export function toInvoice(row: Invoice, payment: Payment | null): StoredInvoice {
  return {
    id: row.id,
    unitId: row.unitId,
    raisedById: row.raisedById,
    period: row.period,
    amountPaise: row.amountPaise as C.Paise,
    dueOn: row.dueOn,
    status: row.status as C.InvoiceStatus,
    cancelledReason: row.cancelledReason,
    payment: payment === null ? null : toPayment(payment),
  };
}

export function toUpdate(row: ComplaintUpdateRow): StoredComplaintUpdate {
  return {
    id: row.id,
    complaintId: row.complaintId,
    updatedById: row.updatedById,
    updatedByName: row.updatedBy.name,
    statusAfter: row.statusAfter as C.ComplaintStatus,
    note: row.note,
    createdAt: row.createdAt,
  };
}

/**
 * A complaint. The update trail is a parameter for the same reason the payment is above: a fresh
 * complaint has none. Photo keys cross as an array and split on the stored newline separator —
 * an object key is opaque to this seam.
 */
export function toComplaint(
  row: Complaint,
  updates: readonly StoredComplaintUpdate[],
): StoredComplaint {
  return {
    id: row.id,
    unitId: row.unitId,
    category: row.category as C.ComplaintCategory,
    priority: row.priority as C.ComplaintPriority,
    description: row.description,
    photoKeys: row.photoKeys === '' ? [] : row.photoKeys.split('\n'),
    status: row.status as C.ComplaintStatus,
    resolvedAt: row.resolvedAt,
    reopenCount: row.reopenCount,
    raisedAt: row.createdAt,
    updates,
  };
}

export function toFacility(row: Facility): StoredFacility {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    hourlyRatePaise: row.hourlyRatePaise as C.Paise,
    active: row.active,
  };
}

export function toBooking(row: BookingRow): StoredBooking {
  return {
    id: row.id,
    facilityId: row.facilityId,
    facilityName: row.facility.name,
    unitId: row.unitId,
    bookingDate: row.bookingDate,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status as C.BookingStatus,
    amountPaise: row.amountPaise as C.Paise,
    requestedAt: row.createdAt,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
  };
}

export function toAnnouncement(row: AnnouncementRow): StoredAnnouncement {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.author.name,
    title: row.title,
    body: row.body,
    category: row.category as C.AnnouncementCategory,
    pinned: row.pinned,
    attachmentKey: row.attachmentKey,
    expiresAt: row.expiresAt,
    // The model has no draft state: a notice is published the moment it is written, so the
    // row's creation instant is its publication instant.
    publishedAt: row.createdAt,
  };
}

export function toNotification(row: Notification): StoredNotification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as C.OutboxEventType,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export function toPushSubscription(row: PushSubscription): StoredPushSubscription {
  return {
    endpoint: row.endpoint,
    userId: row.userId,
    p256dh: row.p256dh,
    auth: row.auth,
    subscribedAt: row.subscribedAt,
    unsubscribedAt: row.unsubscribedAt,
  };
}

// ---------------------------------------------------------------- shared lookups

/**
 * The lookups every port redeclares (`findHome`, `findBlockByName`, `findUnitByLabel`,
 * `countActiveResidentsForUnit`, `findResidentsForUnit`), implemented once. Occupancy is a count
 * of ACTIVE residents, never a stored flag (D-42, D-77).
 */
export function sharedLookups(db: Db) {
  return {
    async findHome(unitId: number): Promise<StoredHome | null> {
      const row = await db.unit.findUnique({ where: { id: unitId }, include: UNIT_INCLUDE });
      return row === null ? null : toHome(row);
    },

    /** Exact match — block names are case-sensitive natural keys on both engines. */
    findBlockByName(name: string): Promise<{ readonly id: number } | null> {
      return db.block.findUnique({ where: { name }, select: { id: true } });
    },

    async findUnitByLabel(blockId: number, label: string): Promise<StoredHome | null> {
      const row = await db.unit.findUnique({
        where: { blockId_label: { blockId, label } },
        include: UNIT_INCLUDE,
      });
      return row === null ? null : toHome(row);
    },

    countActiveResidentsForUnit(unitId: number): Promise<number> {
      return db.residentUser.count({ where: { unitId, status: 'ACTIVE' } });
    },

    /** ACTIVE residents of a unit — the people a household-addressed event is for (D-29). */
    async findResidentsForUnit(
      unitId: number,
    ): Promise<readonly { readonly id: number; readonly name: string; readonly email: string }[]> {
      return db.residentUser.findMany({
        where: { unitId, status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { id: 'asc' },
      });
    },
  };
}

/** Read a unit with its block inside a transaction, for the mutation return paths. */
export function findHomeIn(tx: Tx, unitId: number): Promise<UnitRow | null> {
  return tx.unit.findUnique({ where: { id: unitId }, include: UNIT_INCLUDE });
}

/** Read a pass with both joins inside a transaction, for the mutation return paths. */
export function findPassIn(tx: Tx, passId: number): Promise<PassRow | null> {
  return tx.visitorPass.findUnique({ where: { id: passId }, include: PASS_INCLUDE });
}

export const unitInclude = UNIT_INCLUDE;
export const passInclude = PASS_INCLUDE;
export const invoiceInclude = INVOICE_INCLUDE;
export const bookingInclude = BOOKING_INCLUDE;
export const announcementInclude = ANNOUNCEMENT_INCLUDE;
export const complaintInclude = COMPLAINT_INCLUDE;
