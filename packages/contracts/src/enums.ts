/**
 * Every enumeration in the system, as a frozen tuple plus a label map.
 *
 * Three things depend on this file and nothing else:
 *   - the database, which stores these as plain strings (so one schema works on both
 *     SQLite and PostgreSQL — Prisma cannot express a native enum on SQLite)
 *   - Zod, which validates at every boundary
 *   - the interface, which renders `label`, never the raw value
 *
 * See docs/plan/01-defect-register.md D-16, D-46, D-55.
 */

export type Tone = 'neutral' | 'info' | 'positive' | 'caution' | 'critical';

export interface Descriptor {
  /** What a person reads. Never the raw value. */
  readonly label: string;
  /** Drives colour. Status only — never decoration. */
  readonly tone: Tone;
  /** Optional one-line explanation for tooltips and empty states. */
  readonly hint?: string;
}

type Descriptors<T extends readonly string[]> = {
  readonly [K in T[number]]: Descriptor;
};

/** Narrow an unknown string to a member of `values`, or undefined. */
export function memberOf<const T extends readonly string[]>(
  values: T,
  input: unknown,
): T[number] | undefined {
  return typeof input === 'string' && (values as readonly string[]).includes(input)
    ? (input as T[number])
    : undefined;
}

// ---------------------------------------------------------------- accounts

export const ROLES = ['R', 'A', 'S'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE: Descriptors<typeof ROLES> = {
  R: { label: 'Resident', tone: 'neutral' },
  A: { label: 'Committee', tone: 'info' },
  S: { label: 'Gate', tone: 'caution' },
};

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'DISABLED', 'REJECTED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS: Descriptors<typeof USER_STATUSES> = {
  PENDING: {
    label: 'Awaiting review',
    tone: 'caution',
    hint: 'The committee reviews applications daily.',
  },
  ACTIVE: { label: 'Active', tone: 'positive' },
  DISABLED: { label: 'Suspended', tone: 'critical' },
  REJECTED: { label: 'Declined', tone: 'critical' },
};

// ---------------------------------------------------------------- property

/**
 * The submitted DDL carries only the four flat sizes. Villas, plots and shops are added
 * because the society being modelled has them and the previous build crashed without them
 * (D-16). Recorded in the errata list.
 */
export const UNIT_TYPES = [
  'FLAT_1BHK',
  'FLAT_2BHK',
  'FLAT_3BHK',
  'FLAT_4BHK',
  'VILLA',
  'PLOT',
  'SHOP',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_TYPE: Descriptors<typeof UNIT_TYPES> = {
  FLAT_1BHK: { label: '1 BHK', tone: 'neutral' },
  FLAT_2BHK: { label: '2 BHK', tone: 'neutral' },
  FLAT_3BHK: { label: '3 BHK', tone: 'neutral' },
  FLAT_4BHK: { label: '4 BHK', tone: 'neutral' },
  VILLA: { label: 'Villa', tone: 'neutral' },
  PLOT: { label: 'Plot', tone: 'neutral' },
  SHOP: { label: 'Shop', tone: 'neutral' },
};

// ---------------------------------------------------------------- visitors

export const PASS_STATUSES = ['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED'] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

export const PASS_STATUS: Descriptors<typeof PASS_STATUSES> = {
  ACTIVE: { label: 'Expected', tone: 'positive' },
  USED: { label: 'Arrived', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'critical' },
};

export const APPROVAL_STATUSES = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_STATUS: Descriptors<typeof APPROVAL_STATUSES> = {
  NOT_REQUIRED: { label: 'Pre-approved', tone: 'neutral', hint: 'Arrived on a pass.' },
  PENDING: { label: 'Waiting on you', tone: 'caution' },
  APPROVED: { label: 'Let in', tone: 'positive' },
  REJECTED: { label: 'Turned away', tone: 'critical' },
};

/** What the gate is told after a code lookup. Not a row — a decision. See D-40. */
export const GATE_VERDICTS = ['ADMIT', 'REFUSE'] as const;
export type GateVerdict = (typeof GATE_VERDICTS)[number];

export const GATE_REFUSAL_REASONS = [
  'NOT_FOUND',
  'CANCELLED',
  'ALREADY_USED',
  'WRONG_DAY',
  'EXPIRED',
] as const;
export type GateRefusalReason = (typeof GATE_REFUSAL_REASONS)[number];

export const GATE_REFUSAL_REASON: Descriptors<typeof GATE_REFUSAL_REASONS> = {
  NOT_FOUND: { label: 'No such code', tone: 'critical' },
  CANCELLED: { label: 'Pass was cancelled', tone: 'critical' },
  ALREADY_USED: { label: 'Already used today', tone: 'critical' },
  WRONG_DAY: { label: 'Not valid today', tone: 'critical' },
  EXPIRED: { label: 'Pass has expired', tone: 'critical' },
};

// ---------------------------------------------------------------- complaints

export const COMPLAINT_CATEGORIES = [
  'PLUMBING',
  'ELECTRICAL',
  'CIVIL',
  'SECURITY',
  'COMMON_AREA',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY: Descriptors<typeof COMPLAINT_CATEGORIES> = {
  PLUMBING: { label: 'Plumbing', tone: 'neutral' },
  ELECTRICAL: { label: 'Electrical', tone: 'neutral' },
  CIVIL: { label: 'Civil work', tone: 'neutral' },
  SECURITY: { label: 'Security', tone: 'neutral' },
  COMMON_AREA: { label: 'Common area', tone: 'neutral' },
  OTHER: { label: 'Something else', tone: 'neutral' },
};

export const COMPLAINT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

/** Separate from status. The previous build rendered both through one badge (D-55). */
export const COMPLAINT_PRIORITY: Descriptors<typeof COMPLAINT_PRIORITIES> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Normal', tone: 'info' },
  HIGH: { label: 'High', tone: 'caution' },
  URGENT: { label: 'Urgent', tone: 'critical' },
};

/** `IN_PROGRESS` per docs/data-model.md. The previous schema renamed it `ASSIGNED` (D-46). */
export const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_STATUS: Descriptors<typeof COMPLAINT_STATUSES> = {
  OPEN: { label: 'Reported', tone: 'caution' },
  IN_PROGRESS: { label: 'Being fixed', tone: 'info' },
  RESOLVED: { label: 'Fixed', tone: 'positive', hint: 'Reopen within 7 days if it comes back.' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

// ---------------------------------------------------------------- billing

/** `CANCELLED` restored — it is the only way to void a wrongly raised invoice (D-46). */
export const INVOICE_STATUSES = ['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS: Descriptors<typeof INVOICE_STATUSES> = {
  UNPAID: { label: 'Due', tone: 'caution' },
  PAID: { label: 'Paid', tone: 'positive' },
  OVERDUE: { label: 'Overdue', tone: 'critical' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/**
 * Per docs/data-model.md. No gateway is involved (ADR 0002), but the method a resident picks
 * is a real method and the receipt says so — the word "simulated" does not appear in the
 * product (D-54).
 */
export const PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD: Descriptors<typeof PAYMENT_METHODS> = {
  UPI: { label: 'UPI', tone: 'neutral' },
  CARD: { label: 'Card', tone: 'neutral' },
  NETBANKING: { label: 'Net banking', tone: 'neutral' },
  CASH: { label: 'Cash at the office', tone: 'neutral' },
};

// ---------------------------------------------------------------- facilities

/** `COMPLETED` restored (D-46). */
export const BOOKING_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS: Descriptors<typeof BOOKING_STATUSES> = {
  PENDING: { label: 'Awaiting approval', tone: 'caution' },
  CONFIRMED: { label: 'Confirmed', tone: 'positive' },
  REJECTED: { label: 'Declined', tone: 'critical' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  COMPLETED: { label: 'Done', tone: 'neutral' },
};

/** The two states that hold a slot. The partial unique index is defined over exactly these. */
export const LIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'] as const;

// ---------------------------------------------------------------- announcements

export const ANNOUNCEMENT_CATEGORIES = ['GENERAL', 'MAINTENANCE', 'EVENT', 'URGENT'] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_CATEGORY: Descriptors<typeof ANNOUNCEMENT_CATEGORIES> = {
  GENERAL: { label: 'Notice', tone: 'neutral' },
  MAINTENANCE: { label: 'Maintenance', tone: 'info' },
  EVENT: { label: 'Event', tone: 'positive' },
  URGENT: { label: 'Urgent', tone: 'critical' },
};

// ---------------------------------------------------------------- outbox

/**
 * A handler writes an outbox row inside the same transaction as the change it made, then
 * returns. A worker delivers it. This is what makes UC-29 alternative flow 3a — the caller
 * completes even when mail is down — a property of the design rather than a try/catch in
 * every handler (D-29).
 */
export const OUTBOX_STATUSES = ['PENDING', 'SENT', 'FAILED', 'ABANDONED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_EVENT_TYPES = [
  'resident.registered',
  'resident.approved',
  'resident.declined',
  'password.reset_requested',
  'pass.created',
  'visitor.arrived',
  'walkin.awaiting_decision',
  'walkin.decided',
  'complaint.raised',
  'complaint.updated',
  'complaint.reopened',
  'invoice.raised',
  'invoice.overdue',
  'payment.received',
  'booking.requested',
  'booking.decided',
  'announcement.published',
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export const OUTBOX_CHANNELS = ['EMAIL', 'PUSH', 'IN_APP'] as const;
export type OutboxChannel = (typeof OUTBOX_CHANNELS)[number];
