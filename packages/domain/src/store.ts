import type * as C from '@oneresi/contracts';

/**
 * The data ports the services run on. The db package implements these — domain never touches a
 * client — and everything here is shaped so the implementer can keep each call in ONE
 * transaction: wherever a change and its outbox events belong together, they arrive together as
 * one call (D-29).
 *
 * Times are passed IN by the service, from its clock. The store never reads the wall clock, so
 * the whole service stays testable by moving one hand.
 */

// ---------------------------------------------------------------- records

/**
 * An account as the auth seam reads it. `passwordHash` crosses this seam for exactly three
 * flows — sign-in, password reset and password change — because those are the three places a
 * password must be compared, and the comparison lives in the service so the policy lives there
 * too. It is never mapped into a view, never logged and never returned by a service. Anywhere
 * else it appears, that is D-12 again.
 */
export interface StoredAccount {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly passwordHash: string;
  readonly role: C.Role;
  readonly status: C.UserStatus;
  readonly unitId: number | null;
  /** Set on every password change; a token issued before it is refused (D-23). */
  readonly passwordChangedAt: Date | null;
  /** SHA-256 of a single-use reset token. The token itself is never stored (D-22). */
  readonly resetTokenHash: string | null;
  readonly resetExpiresAt: Date | null;
}

/** A unit with its block, as registration and profiles need it. */
export interface StoredHome {
  readonly unitId: number;
  readonly blockId: number;
  readonly blockName: string;
  readonly label: string;
  readonly type: C.UnitType;
  readonly monthlyChargePaise: C.Paise;
  readonly active: boolean;
}

/**
 * The free-text home an applicant described because their unit was not on the list. Held until
 * the committee decides the application; resolved by `applyRegistrationDecision` (D-04).
 */
export interface StoredClaim {
  readonly blockName: string;
  readonly unitLabel: string;
  readonly unitType: C.UnitType;
  readonly note: string | null;
}

/** A new account. Role is decided by the service, never the request body (D-01). */
export interface NewAccount {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly passwordHash: string;
  readonly role: C.Role;
  readonly status: C.UserStatus;
  readonly unitId: number | null;
  /**
   * The stamp of the password just set. Recorded at birth so every account carries one from the
   * first sign-in — a null stamp only exists for rows created before this seam did (D-23).
   */
  readonly passwordChangedAt: Date | null;
}

/**
 * The home a claim resolves to, supplied by the service on approval. The charge is zero until
 * an administrator sets it — an applicant never sets a charge, which is what every invoice
 * snapshots (D-04).
 */
export interface ClaimResolution {
  readonly blockName: string;
  readonly unitLabel: string;
  readonly unitType: C.UnitType;
  readonly monthlyChargePaise: C.Paise;
}

/** A refresh token to store. Only `hashToken(value)` is ever persisted (D-24). */
export interface NewRefreshToken {
  readonly tokenHash: string;
  readonly userId: number;
  readonly expiresAt: Date;
  /** The token this one replaced — the family link that makes replay detectable. */
  readonly replacesId: number | null;
  readonly userAgent: string | null;
}

export interface StoredRefreshToken {
  readonly id: number;
  readonly userId: number;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacesId: number | null;
}

/**
 * One outbox row the service asks for, written in the same transaction as the change that
 * caused it. The payload is flat scalars so it survives being stringified as JSON on either
 * database. It deliberately carries no surrogate ids — mail addresses people by name and email,
 * and ids differ between targets by design. The one exception is an id the event is ABOUT
 * (`invoiceId`, `complaintId`, …): those arrive through the `eventsFor` callbacks below, which
 * the adapter calls with the row it just inserted.
 *
 * Recipient convention: the `name` and `email` keys identify the ONE person the message is for;
 * every other key is a template variable. The adapter lifts those two into the mail envelope's
 * `to` and passes the rest as `vars`.
 */
export interface OutboxEventInput {
  readonly type: C.OutboxEventType;
  readonly channel: C.OutboxChannel;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: string;
}

/**
 * A visitor pass as the services read it. `createdByName` is the host the gate is told about, and
 * `enteredAt`/`exitedAt` come from the pass's log row — joins the db layer supplies, so a list of
 * passes never costs one query per pass.
 */
export interface StoredVisitorPass {
  readonly id: number;
  readonly unitId: number;
  readonly createdById: number;
  readonly createdByName: string;
  readonly visitorName: string;
  readonly purpose: string;
  readonly code: string;
  readonly validOn: Date;
  readonly status: C.PassStatus;
  readonly createdAt: Date;
  readonly enteredAt: Date | null;
  readonly exitedAt: Date | null;
}

/** A new pass. It is born ACTIVE — the only status a pass starts in. */
export interface NewVisitorPass {
  readonly unitId: number;
  readonly createdById: number;
  readonly visitorName: string;
  readonly purpose: string;
  readonly code: string;
  readonly validOn: Date;
  readonly createdAt: Date;
}

/**
 * One row of the gate log: either a pass's check-in, or a walk-in the guard logged before the
 * visitor was let in (UC-16). `passId` is null exactly when the row is a walk-in.
 */
export interface StoredVisitorLog {
  readonly id: number;
  readonly passId: number | null;
  readonly unitId: number;
  readonly walkInName: string | null;
  readonly walkInPhone: string | null;
  readonly walkInPurpose: string | null;
  readonly approvalStatus: C.ApprovalStatus;
  /**
   * Who answered, and when — written on every APPROVED and REJECTED row. The columns UC-05 needs
   * and the previous build never set (D-21).
   */
  readonly decidedById: number | null;
  readonly decidedAt: Date | null;
  /** A guard's reason for admitting without waiting. The exception names itself (D-21). */
  readonly overrideReason: string | null;
  readonly enteredAt: Date | null;
  readonly exitedAt: Date | null;
  readonly createdAt: Date;
}

/** A new gate-log row, for a pass check-in or a walk-in. */
export interface NewVisitorLog {
  readonly passId: number | null;
  readonly unitId: number;
  readonly walkInName: string | null;
  readonly walkInPhone: string | null;
  readonly walkInPurpose: string | null;
  readonly approvalStatus: C.ApprovalStatus;
  readonly decidedById: number | null;
  readonly decidedAt: Date | null;
  readonly overrideReason: string | null;
  readonly enteredAt: Date | null;
  readonly createdAt: Date;
}

/**
 * One gate-log row joined for the household's feed: the visitor NAMED, whether the name came from
 * a pass or the guard's own words, and the decision attributed to a person rather than an id
 * (D-21). `kind` is `'PASS'` exactly when the row's `passId` is set.
 */
export interface StoredVisitorEntry {
  readonly logId: number;
  readonly kind: 'PASS' | 'WALK_IN';
  readonly visitorName: string;
  readonly purpose: string;
  readonly approvalStatus: C.ApprovalStatus;
  readonly decidedByName: string | null;
  readonly overrideReason: string | null;
  readonly enteredAt: Date | null;
  readonly exitedAt: Date | null;
  readonly createdAt: Date;
}

export interface StoredBlock {
  readonly id: number;
  readonly name: string;
  readonly floors: number;
  readonly active: boolean;
}

/** The public registration list: active blocks with their active units. Charges never appear. */
export interface RegistrationOptionsBlock {
  readonly blockId: number;
  readonly blockName: string;
  readonly units: readonly { readonly unitId: number; readonly label: string }[];
}

/** The committee's list: every block, retired ones included, with a unit count. */
export interface AdminBlockView {
  readonly id: number;
  readonly name: string;
  readonly floors: number;
  readonly active: boolean;
  readonly unitCount: number;
}

/**
 * An invoice with its payment joined in. `payment` is the settlement the status claims: the
 * previous build returned invoices marked PAID with no payment row behind them, and the receipt
 * button invented the rest (D-26). Exactly one payment exists per invoice — settlement is in
 * full, and the UNPAID/OVERDUE -> PAID guard refuses a second row.
 */
export interface StoredInvoice {
  readonly id: number;
  readonly unitId: number;
  /** Attribution for the billing run. */
  readonly raisedById: number;
  /** `YYYY-MM`. */
  readonly period: string;
  /** Snapshotted at generation; a charge change never reprices a raised invoice (D-50). */
  readonly amountPaise: C.Paise;
  readonly dueOn: Date;
  readonly status: C.InvoiceStatus;
  readonly cancelledReason: string | null;
  readonly payment: StoredPayment | null;
}

export interface StoredPayment {
  readonly id: number;
  readonly invoiceId: number;
  /** Who entered the payment — a committee member taking cash; null for online settlement. */
  readonly recordedById: number | null;
  readonly amountPaise: C.Paise;
  readonly method: C.PaymentMethod;
  /** Period plus a per-period sequence, allocated inside the payment transaction (D-37). */
  readonly receiptNo: string;
  /** The opaque reference that stands in for a gateway order id (D-54). */
  readonly reference: string;
  readonly paidAt: Date;
}

/**
 * A receipt is server-rendered from the persisted payment row, addressed by number so the URL
 * survives a target switch (D-26). The submitted model keeps no payer column, so the household
 * names itself: `payerName` is the unit's first-listed ACTIVE resident, joined by the store.
 */
export interface StoredReceipt {
  readonly payment: StoredPayment;
  readonly invoice: StoredInvoice;
  readonly home: StoredHome;
  readonly payerName: string;
}

export interface StoredComplaint {
  readonly id: number;
  readonly unitId: number;
  readonly category: C.ComplaintCategory;
  readonly priority: C.ComplaintPriority;
  readonly description: string;
  /**
   * Up to three S3 object keys. The service never inspects them — an object key is an opaque
   * string a presigned upload produced — so they cross as an array and the adapter joins or
   * splits on the stored newline separator.
   */
  readonly photoKeys: readonly string[];
  readonly status: C.ComplaintStatus;
  /** Set on entering RESOLVED, never cleared except by an explicit reopen (D-20). */
  readonly resolvedAt: Date | null;
  readonly reopenCount: number;
  readonly raisedAt: Date;
  /** Every status change with its attribution, oldest first. */
  readonly updates: readonly StoredComplaintUpdate[];
}

export interface StoredComplaintUpdate {
  readonly id: number;
  readonly complaintId: number;
  readonly updatedById: number;
  /** The acting identity, joined — UC-20 step 3 requires a name, not a bare foreign key. */
  readonly updatedByName: string;
  readonly statusAfter: C.ComplaintStatus;
  readonly note: string;
  readonly createdAt: Date;
}

export interface NewComplaint {
  readonly unitId: number;
  readonly category: C.ComplaintCategory;
  readonly priority: C.ComplaintPriority;
  readonly description: string;
  readonly photoKeys: readonly string[];
  readonly raisedAt: Date;
}

export interface StoredFacility {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** `HH:MM`, zero padded, so lexical order is chronological. Enforced on booking (D-72). */
  readonly opensAt: string;
  readonly closesAt: string;
  readonly hourlyRatePaise: C.Paise;
  readonly active: boolean;
}

export interface StoredBooking {
  readonly id: number;
  readonly facilityId: number;
  /** Joined, so a household's list never costs one query per booking. */
  readonly facilityName: string;
  readonly unitId: number;
  readonly bookingDate: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: C.BookingStatus;
  /** Charged at request time from the facility's rate and the window length (D-72). */
  readonly amountPaise: C.Paise;
  readonly requestedAt: Date;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
}

export interface NewBooking {
  readonly facilityId: number;
  readonly unitId: number;
  readonly bookingDate: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly amountPaise: C.Paise;
  readonly requestedAt: Date;
}

export interface StoredAnnouncement {
  readonly id: number;
  readonly authorId: number;
  readonly authorName: string;
  readonly title: string;
  readonly body: string;
  readonly category: C.AnnouncementCategory;
  readonly pinned: boolean;
  readonly attachmentKey: string | null;
  /** The date the notice drops off the feed. UC-24 requires it (D-46). */
  readonly expiresAt: Date | null;
  readonly publishedAt: Date;
}

export interface NewAnnouncement {
  readonly authorId: number;
  readonly title: string;
  readonly body: string;
  readonly category: C.AnnouncementCategory;
  readonly pinned: boolean;
  readonly attachmentKey: string | null;
  readonly expiresAt: Date | null;
  readonly publishedAt: Date;
}

export interface StoredNotification {
  readonly id: number;
  readonly userId: number;
  readonly type: C.OutboxEventType;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NewNotification {
  readonly userId: number;
  readonly type: C.OutboxEventType;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly createdAt: Date;
}

/**
 * A browser's Web Push subscription as the notification seam reads it. `endpoint` is the push
 * service's own URL for the device and the table's natural key; the two keys are exactly the
 * strings the browser produced, base64url, needed verbatim to encrypt a message to it.
 */
export interface StoredPushSubscription {
  readonly endpoint: string;
  readonly userId: number;
  readonly p256dh: string;
  readonly auth: string;
  readonly subscribedAt: Date;
  readonly unsubscribedAt: Date | null;
}

/** A subscription to store or refresh. Times are passed in by the service, from its clock. */
export interface NewPushSubscription {
  readonly userId: number;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly subscribedAt: Date;
}

// ---------------------------------------------------------------- ports

export interface AccountStore {
  findAccountByEmail(email: string): Promise<StoredAccount | null>;
  findAccountById(id: number): Promise<StoredAccount | null>;
  /** By the SHA-256 of the reset token — the only place that hash is looked up (D-22). */
  findAccountByResetTokenHash(tokenHash: string): Promise<StoredAccount | null>;

  findHome(unitId: number): Promise<StoredHome | null>;
  findBlockByName(name: string): Promise<{ readonly id: number } | null>;
  findUnitByLabel(blockId: number, label: string): Promise<StoredHome | null>;

  /**
   * ACTIVE residents on one unit. Occupancy is derived from a count, never a stored flag that
   * can drift — a declined resident never bills a unit forever (D-42, D-77).
   */
  countActiveResidentsForUnit(unitId: number): Promise<number>;

  /**
   * Accounts of every role and status. Zero means the database holds nobody at all — the next
   * registration bootstraps the society as its first resident rather than queueing for a
   * committee that does not exist yet.
   */
  countAccounts(): Promise<number>;

  /**
   * One transaction: the account row, its optional home claim, and the paired outbox events.
   */
  createAccount(
    input: NewAccount,
    claim: StoredClaim | null,
    events: readonly OutboxEventInput[],
  ): Promise<StoredAccount>;

  /** The free-text claim on a pending application, for the committee to resolve (D-04). */
  findClaim(userId: number): Promise<StoredClaim | null>;

  /**
   * PENDING accounts, oldest first, each with its live claim — the committee's queue. The claim
   * is the LIVE one (`findClaim`'s own rule): a claim already resolved to a unit reads as null,
   * which for a PENDING account cannot happen but for a re-opened one is the honest answer.
   */
  listPendingApplications(): Promise<
    readonly {
      readonly userId: number;
      readonly name: string;
      readonly email: string;
      readonly phone: string;
      readonly appliedAt: Date;
      readonly claim: StoredClaim | null;
    }[]
  >;

  /**
   * The committee's decision, in one transaction. `approve` transitions the account to ACTIVE
   * and, when a claim is supplied, resolves it: find-or-create the block, find-or-create the
   * unit, link the account, clear the claim. Declining transitions to REJECTED and leaves the
   * claim in place — REJECTED may become PENDING again, and nothing is occupied either way
   * because occupancy counts ACTIVE residents only (D-42). The caller has already validated the
   * transition against USER_TRANSITIONS; the store applies, it does not decide.
   */
  applyRegistrationDecision(
    input: {
      readonly userId: number;
      readonly approve: boolean;
      readonly reason: string | null;
      readonly claim: ClaimResolution | null;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredAccount | null>;

  /**
   * One transaction: the reset token's hash and expiry, plus the reset-requested outbox event
   * carrying the raw token to the mail worker. The outbox row is internal to the database; only
   * the worker reads it, and the worker builds the link from configuration so no resident is
   * ever emailed a localhost address (D-22).
   */
  setResetToken(
    userId: number,
    tokenHash: string,
    expiresAt: Date,
    events: readonly OutboxEventInput[],
  ): Promise<void>;

  /**
   * One transaction: the new hash, `passwordChangedAt`, every refresh token for the account
   * revoked, and the single-use reset token cleared (D-22, D-23, D-24).
   */
  applyPasswordReset(userId: number, passwordHash: string, passwordChangedAt: Date): Promise<void>;

  /**
   * One transaction: the new hash, `passwordChangedAt`, every refresh token revoked. A signed-in
   * password change kills every session, including the changer's (D-23).
   */
  applyPasswordChange(userId: number, passwordHash: string, passwordChangedAt: Date): Promise<void>;

  createRefreshToken(input: NewRefreshToken): Promise<StoredRefreshToken>;
  findRefreshTokenByHash(tokenHash: string): Promise<StoredRefreshToken | null>;

  /**
   * One transaction: if the token is already revoked — a replay — return null and change
   * nothing; otherwise set its `revokedAt` and insert the replacement. This is the rotation
   * step, and its null return is how reuse is detected (D-24).
   */
  rotateRefreshToken(
    oldId: number,
    revokedAt: Date,
    replacement: NewRefreshToken,
  ): Promise<StoredRefreshToken | null>;

  /**
   * Given any token in a chain, revoke the whole family: follow `replacesId` up to the root the
   * sign-in created, then revoke the root and every descendant. A family grows only by
   * rotation, so this is every token derived from one sign-in.
   */
  revokeRefreshFamily(tokenId: number, revokedAt: Date): Promise<void>;

  revokeAllRefreshTokens(userId: number, revokedAt: Date): Promise<void>;
}

/**
 * The visitors service's view of the database. The lookups it shares with AccountStore
 * (`findHome`) are declared here as well — the db adapter implements each method once no matter
 * how many ports declare it, and declaring them here keeps every service's needs in one place.
 */
export interface VisitorStore {
  findHome(unitId: number): Promise<StoredHome | null>;

  /**
   * ACTIVE residents of a unit — the people a gate notification is addressed to. One outbox row
   * is written per recipient (D-29), so the service needs every name and email up front.
   */
  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { readonly id: number; readonly name: string; readonly email: string }[]>;

  findPassByCode(code: string): Promise<StoredVisitorPass | null>;
  findPassById(id: number): Promise<StoredVisitorPass | null>;

  /**
   * One household's passes, narrowed by the caller's filter — history passes `{}`, expected-today
   * passes a date and statuses. The filter is an argument, never a fall-through, so a query
   * cannot silently widen.
   */
  findPassesForUnit(
    unitId: number,
    filter: { readonly validOn?: Date; readonly statuses?: readonly C.PassStatus[] },
  ): Promise<readonly StoredVisitorPass[]>;

  /**
   * One transaction: the pass row and its events. Null when the generated code is already taken —
   * six digits collide eventually, and the caller answers a collision with a fresh code, not an
   * error.
   */
  createPass(
    input: NewVisitorPass,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null>;

  /**
   * One transaction: the guarded ACTIVE -> CANCELLED transition and its events. Null when the pass
   * stopped being ACTIVE between the caller's check and this call — the caller already validated
   * the transition against PASS_TRANSITIONS, so null means the world changed underneath it.
   */
  cancelPass(
    id: number,
    cancelledAt: Date,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null>;

  /**
   * One transaction: the guarded ACTIVE -> USED transition, the log row that says the visitor
   * walked in, and the arrival's events (D-40). Null when the pass stopped being ACTIVE between
   * the caller's check and this call.
   */
  checkInPass(
    input: { readonly passId: number; readonly at: Date; readonly idempotencyKey: string | null },
    log: NewVisitorLog,
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorPass | null>;

  /**
   * One transaction: stamps `exitedAt` on the pass's open log row. Null when there is no open
   * entry to close.
   */
  checkOutPass(passId: number, at: Date): Promise<StoredVisitorLog | null>;

  /** One transaction: the walk-in row and its events (D-21, D-29). */
  createWalkInLog(input: NewVisitorLog, events: readonly OutboxEventInput[]): Promise<StoredVisitorLog>;

  findLogById(id: number): Promise<StoredVisitorLog | null>;

  /** The household's undecided walk-ins, oldest first — the queue a resident answers. */
  findPendingWalkIns(unitId: number): Promise<readonly StoredVisitorLog[]>;

  /**
   * The household's gate log, newest first, joined so every row names its visitor — the feed on
   * a resident's home. `limit` is the caller's rule; the store truncates and orders, it does not
   * decide what "recent" means.
   */
  findLogsForUnit(
    unitId: number,
    limit: number,
  ): Promise<readonly StoredVisitorEntry[]>;

  /**
   * One transaction: approvalStatus, decidedById, decidedAt — the attribution UC-05 was missing
   * (D-21) — and the decision's events. Null when the visit is no longer PENDING: a decision is a
   * guarded transition, not an assignment.
   */
  decideWalkInLog(
    input: {
      readonly logId: number;
      readonly approvalStatus: 'APPROVED' | 'REJECTED';
      readonly decidedById: number;
      readonly decidedAt: Date;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredVisitorLog | null>;
}

/**
 * The property service's view of the database. As with VisitorStore, lookups shared with
 * AccountStore are redeclared here so this port reads standalone; the adapter implements them once.
 */
export interface PropertyStore {
  registrationOptions(): Promise<readonly RegistrationOptionsBlock[]>;
  blocksForAdmin(): Promise<readonly AdminBlockView[]>;

  findBlockById(id: number): Promise<StoredBlock | null>;
  findBlockByName(name: string): Promise<{ readonly id: number } | null>;
  findUnitByLabel(blockId: number, label: string): Promise<StoredHome | null>;
  findHome(unitId: number): Promise<StoredHome | null>;
  /**
   * ACTIVE residents on one unit. Occupancy is derived from this count, never stored as a flag
   * that can drift (D-42, D-77).
   */
  countActiveResidentsForUnit(unitId: number): Promise<number>;

  /**
   * No outbox vocabulary exists for property changes today; the events parameter keeps this seam
   * the same shape as every other mutation, so the first event that does arrive lands in the same
   * transaction instead of forking one (D-29). Null = the name is taken (Block.name is unique).
   */
  createBlock(
    input: { readonly name: string; readonly floors: number },
    events: readonly OutboxEventInput[],
  ): Promise<{ readonly id: number } | null>;

  /** Null = the label is taken within that block ((block, label) is the natural key). */
  createUnit(
    input: {
      readonly blockId: number;
      readonly label: string;
      readonly type: C.UnitType;
      readonly monthlyChargePaise: C.Paise;
    },
    events: readonly OutboxEventInput[],
  ): Promise<{ readonly id: number } | null>;

  /** Applies the patch and returns the unit as it now stands. Null = unit unknown. */
  updateUnit(
    input: {
      readonly unitId: number;
      readonly type?: C.UnitType;
      readonly monthlyChargePaise?: C.Paise;
      readonly active?: boolean;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredHome | null>;
}

/**
 * The billing service's view of the database. Shared lookups (`findHome`,
 * `findResidentsForUnit`) are redeclared as in the ports above; the adapter implements each
 * method once.
 *
 * Two methods here take an `eventsFor` callback rather than an events array, because the event
 * payload carries a value that exists only once the insert has run: the invoice's own id, and
 * the receipt number the payment transaction allocates. The adapter calls the callback with the
 * row it just wrote, inside the same transaction, and inserts what it returns.
 */
export interface BillingStore {
  findHome(unitId: number): Promise<StoredHome | null>;
  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { readonly id: number; readonly name: string; readonly email: string }[]>;

  /**
   * Active units with a charge to bill — the run's census, with the label an email needs. A
   * unit with no charge has nothing to collect and is not in the list.
   */
  billableUnits(): Promise<
    readonly {
      readonly unitId: number;
      readonly blockName: string;
      readonly label: string;
      readonly monthlyChargePaise: C.Paise;
    }[]
  >;

  /**
   * The friendly pre-check for a period already generated. The guarantee itself is the
   * `(unitId, period)` unique constraint inside `raiseInvoices` (D-17).
   */
  countInvoicesForPeriod(period: string): Promise<number>;

  findInvoiceById(id: number): Promise<StoredInvoice | null>;
  findInvoicesForUnit(unitId: number): Promise<readonly StoredInvoice[]>;

  /**
   * Every invoice in the society, newest period first, each with its home joined so the
   * committee's ledger names the payer. One query with its joins, like the household list.
   */
  findInvoicesForSociety(): Promise<readonly (StoredInvoice & { home: StoredHome })[]>;

  /**
   * One transaction: every invoice for the period, or none. Null when any unit in `units`
   * already has an invoice for the period — the architecture refuses the whole run rather than
   * reporting a partial count (D-17, D-29). Amounts are snapshotted from the census the caller
   * just read, so the invoice never depends on the unit's current charge again (D-50).
   */
  raiseInvoices(
    input: { readonly period: string; readonly dueOn: Date; readonly raisedById: number; readonly raisedAt: Date },
    units: readonly { readonly unitId: number; readonly amountPaise: C.Paise }[],
    eventsFor: (invoice: StoredInvoice) => readonly OutboxEventInput[],
  ): Promise<readonly StoredInvoice[] | null>;

  /**
   * One transaction: allocate the period's next receipt number from `ReceiptSequence` (the
   * increment rolls back with the payment, so the run stays gap-free, D-37), insert the payment
   * with the reference the caller derived, and apply the guarded UNPAID/OVERDUE -> PAID
   * transition to the invoice. The receipt number is formatted with the shared token helper so
   * the rule exists in exactly one place.
   *
   * Null when the invoice stopped being payable between the caller's check and this call. When
   * `reference` already exists, the existing payment is returned unchanged and nothing is
   * written — a repeated confirmation of the same intent must produce one row, not two.
   */
  recordPayment(
    input: {
      readonly invoiceId: number;
      readonly recordedById: number | null;
      readonly amountPaise: C.Paise;
      readonly method: C.PaymentMethod;
      readonly paidAt: Date;
      readonly reference: string;
    },
    eventsFor: (payment: StoredPayment) => readonly OutboxEventInput[],
  ): Promise<StoredPayment | null>;

  /**
   * One transaction: the guarded UNPAID/OVERDUE -> CANCELLED transition and its reason — the
   * only way to void a wrongly raised invoice. No outbox event type exists for a cancellation;
   * the events parameter keeps the seam's shape. Null when the invoice is no longer in a
   * cancellable state.
   */
  cancelInvoice(
    input: { readonly invoiceId: number; readonly reason: string; readonly cancelledAt: Date },
    events: readonly OutboxEventInput[],
  ): Promise<StoredInvoice | null>;

  /**
   * One transaction: every UNPAID invoice whose due date falls strictly before `dueBefore` —
   * the instant the caller's "today" began, computed by the service so the store never decides
   * what today means — flagged OVERDUE. The one rule the scheduled job reuses (D-36, including
   * the off-by-one that flagged an invoice due today at 00:01). The callback is async because
   * the overdue events are addressed per household, which the caller learns only here.
   */
  markInvoicesOverdue(
    input: { readonly dueBefore: Date },
    eventsFor: (invoice: StoredInvoice) => Promise<readonly OutboxEventInput[]>,
  ): Promise<readonly StoredInvoice[]>;

  /** A receipt by its number, with the payment, invoice and home joined (D-26). */
  findReceiptByNo(receiptNo: string): Promise<StoredReceipt | null>;
}

export interface ComplaintStore {
  findComplaintById(id: number): Promise<StoredComplaint | null>;
  findComplaintsForUnit(unitId: number): Promise<readonly StoredComplaint[]>;
  /** The committee desk's list, optionally narrowed to one status. */
  findComplaintsForSociety(
    filter: { readonly status?: C.ComplaintStatus },
  ): Promise<readonly StoredComplaint[]>;

  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { readonly id: number; readonly name: string; readonly email: string }[]>;

  /**
   * One transaction: the complaint row and its acknowledgement events. The callback receives
   * the row with its id, because the in-app event names the complaint.
   */
  createComplaint(
    input: NewComplaint,
    eventsFor: (complaint: StoredComplaint) => readonly OutboxEventInput[],
  ): Promise<StoredComplaint>;

  /**
   * One transaction: the status change, its attributed update row, and the events. The store
   * applies only a transition the contract's state machine permits from the CURRENT status —
   * the caller has already validated it, so null means the world changed underneath. Entering
   * RESOLVED sets `resolvedAt`; a RESOLVED -> OPEN move clears it and advances `reopenCount` —
   * a reopen, whoever made it; nothing else touches the timestamp (D-20).
   */
  applyComplaintUpdate(
    input: {
      readonly complaintId: number;
      readonly statusAfter: C.ComplaintStatus;
      readonly updatedById: number;
      readonly note: string;
      readonly at: Date;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredComplaint | null>;

  /**
   * One transaction: the guarded RESOLVED -> OPEN transition, `resolvedAt` cleared (the one
   * transition allowed to clear it), `reopenCount` advanced, and the resident's reason recorded
   * as an attributed update row. Null when the complaint is no longer RESOLVED.
   */
  reopenComplaint(
    input: {
      readonly complaintId: number;
      readonly reopenedById: number;
      readonly reason: string;
      readonly at: Date;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredComplaint | null>;
}

export interface FacilitiesStore {
  findHome(unitId: number): Promise<StoredHome | null>;
  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { readonly id: number; readonly name: string; readonly email: string }[]>;

  findFacilityById(id: number): Promise<StoredFacility | null>;
  /** The bookable list. The committee sees retired facilities too (UC-22, D-27). */
  listFacilities(input: { readonly includeInactive: boolean }): Promise<readonly StoredFacility[]>;

  findBookingById(id: number): Promise<StoredBooking | null>;
  findBookingsForUnit(unitId: number): Promise<readonly StoredBooking[]>;

  /**
   * Every booking in the society, newest first, each with its home joined — the committee's
   * decision queue, so the desk sees who asked and not just which unit id.
   */
  findBookingsForSociety(): Promise<readonly (StoredBooking & { home: StoredHome })[]>;

  /**
   * PENDING and CONFIRMED bookings for one facility on one date — the slots that are held, read
   * against the partial unique index's own definition of "live" (D-18).
   */
  liveBookingsForFacilityOn(facilityId: number, on: Date): Promise<readonly StoredBooking[]>;

  /** ACTIVE committee members — the people a booking request is addressed to. */
  findCommitteeMembers(): Promise<
    readonly { readonly id: number; readonly name: string; readonly email: string }[]
  >;

  /**
   * One transaction: the booking row and the committee's request events. Null when the window
   * collides with a live booking — the friendly refusal; the partial unique index is what makes
   * it true under concurrency (D-18). The callback receives the row with its id, because the
   * event payload names the booking.
   */
  createBooking(
    input: NewBooking,
    eventsFor: (booking: StoredBooking) => readonly OutboxEventInput[],
  ): Promise<StoredBooking | null>;

  /**
   * One transaction: the guarded PENDING -> CONFIRMED/REJECTED transition with its attribution,
   * and the household's decision events. Null when the booking stopped being PENDING.
   */
  decideBooking(
    input: {
      readonly bookingId: number;
      readonly statusAfter: 'CONFIRMED' | 'REJECTED';
      readonly decidedById: number;
      readonly decidedAt: Date;
      readonly reason: string | null;
    },
    events: readonly OutboxEventInput[],
  ): Promise<StoredBooking | null>;

  /**
   * One transaction: the guarded PENDING/CONFIRMED -> CANCELLED transition. No outbox event type
   * exists for a cancellation; the parameter keeps the seam's shape. Null when the booking is no
   * longer in a cancellable state.
   */
  cancelBooking(
    input: { readonly bookingId: number; readonly cancelledAt: Date },
    events: readonly OutboxEventInput[],
  ): Promise<StoredBooking | null>;
}

export interface NoticesStore {
  /** Not expired as of `now`: pinned first, then newest first (D-46). */
  activeAnnouncements(now: Date): Promise<readonly StoredAnnouncement[]>;

  findAnnouncementById(id: number): Promise<StoredAnnouncement | null>;

  /** Every ACTIVE resident — one outbox row per person, never one message with every address (D-29). */
  findActiveResidents(): Promise<
    readonly { readonly id: number; readonly name: string; readonly email: string }[]
  >;

  /**
   * One transaction: the announcement row and its fan-out events. The callback receives the row
   * with its id, because the event payload names the notice.
   */
  createAnnouncement(
    input: NewAnnouncement,
    eventsFor: (announcement: StoredAnnouncement) => readonly OutboxEventInput[],
  ): Promise<StoredAnnouncement>;

  /**
   * One transaction: expiry pulled to `at`, which takes the notice off every feed. Null when the
   * announcement is unknown. No outbox event type exists for a withdrawal; the parameter keeps
   * the seam's shape.
   */
  withdrawAnnouncement(
    id: number,
    at: Date,
    events: readonly OutboxEventInput[],
  ): Promise<StoredAnnouncement | null>;
}

export interface NotificationsStore {
  /** One person's notifications, newest first. */
  notificationsForUser(userId: number): Promise<readonly StoredNotification[]>;

  /**
   * One transaction: marks the given rows read. Scoped to the user — another person's ids mark
   * nothing, so the call cannot reach across households. Returns how many rows changed.
   */
  markNotificationsRead(userId: number, ids: readonly number[], readAt: Date): Promise<number>;

  /** The worker's fan-in: one notification row per person per in-app outbox event (D-29). */
  createNotifications(rows: readonly NewNotification[]): Promise<void>;

  /**
   * Upserts by the endpoint URL — the push service's own identifier for one browser. A
   * re-subscription (the browser rotated its keys, or a device changed accounts) re-claims the
   * row for the caller: `userId` and the keys are updated too, and an unsubscribed stamp is
   * cleared, because the subscription must follow the account that last asked for it.
   */
  upsertSubscription(input: NewPushSubscription): Promise<StoredPushSubscription>;

  /** The person's active subscriptions — every device they subscribed on, oldest first. */
  activeSubscriptionsForUser(userId: number): Promise<readonly StoredPushSubscription[]>;

  /**
   * Marks one subscription unsubscribed, never deletes it — the stamps are the person's delivery
   * history, and resubscribing is an upsert that clears the stamp. Scoped to the user, so another
   * person's endpoint retires nothing; returns how many rows changed, so retiring twice is a
   * no-op rather than an error.
   */
  markSubscriptionUnsubscribed(userId: number, endpoint: string, at: Date): Promise<number>;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Seconds until the window closes and another attempt is countable. */
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window counters, keyed like `signIn:ashvin@example.com` or `register:10.0.1.5`. The
 * service owns WHICH limits apply; the store only counts.
 */
export interface RateLimiter {
  /** Records one attempt and reports whether the limit still allows it. */
  consume(
    key: string,
    limit: { readonly attempts: number; readonly windowSeconds: number },
  ): Promise<RateLimitVerdict>;
  /** Clears the window — called after a successful sign-in so a streak of typos forgives. */
  clear(key: string): Promise<void>;
}
