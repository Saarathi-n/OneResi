/**
 * The table manifest: every table, its natural key, and the order foreign keys allow it to be
 * written in.
 *
 * Three things read this and would otherwise each keep their own list:
 *   - the checksum tool, which compares two databases table by table
 *   - the sync tool, which exports and upserts by natural key rather than by surrogate id
 *   - the seed, which must converge rather than duplicate on a second run (D-45)
 */

export const DOMAIN_TABLES = [
  'block',
  'unit',
  'residentUser',
  'registrationClaim',
  'facility',
  'visitorPass',
  'visitorLog',
  'complaint',
  'complaintUpdate',
  'invoice',
  'payment',
  'booking',
  'announcement',
] as const;

export const INFRASTRUCTURE_TABLES = [
  'outboxEvent',
  'mailMessage',
  'notification',
  'refreshToken',
  'rateLimitWindow',
  'receiptSequence',
  'schemaFingerprint',
] as const;

export type DomainTable = (typeof DOMAIN_TABLES)[number];
export type InfrastructureTable = (typeof INFRASTRUCTURE_TABLES)[number];
export type TableName = DomainTable | InfrastructureTable;

/**
 * Write order. A table may only be written after everything it points at.
 * Reverse it to delete.
 */
export const WRITE_ORDER: readonly DomainTable[] = DOMAIN_TABLES;

/**
 * What makes a row the same row in two different databases. Surrogate ids differ between targets
 * by design, so nothing outside the database may depend on one — see
 * docs/plan/02-architecture.md.
 */
export const NATURAL_KEYS = {
  block: ['name'],
  unit: ['blockId', 'label'],
  residentUser: ['email'],
  facility: ['name'],
  visitorPass: ['code'],
  visitorLog: ['unitId', 'createdAt'],
  complaint: ['unitId', 'createdAt'],
  complaintUpdate: ['complaintId', 'createdAt'],
  invoice: ['unitId', 'period'],
  payment: ['reference'],
  booking: ['facilityId', 'bookingDate', 'startTime'],
  announcement: ['createdAt', 'title'],
} as const satisfies Record<DomainTable, readonly string[]>;
