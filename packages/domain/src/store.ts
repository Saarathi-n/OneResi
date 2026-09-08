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
 * and ids differ between targets by design.
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
