import type * as C from '@oneresi/contracts';

/**
 * The seam. Every use case is a function here; route handlers call one and contain no rules.
 *
 * Streams working in parallel code against these signatures. See docs/plan/WIRING.md.
 */

// ---------------------------------------------------------------- actor

/**
 * Who is asking. Resolved from the session by the caller, never trusted from a request body.
 * `unitId` is present only for residents.
 */
export interface Actor {
  readonly userId: number;
  readonly role: C.Role;
  readonly unitId: number | null;
  readonly email: string;
}

/** For jobs and workers with no human behind them. */
export interface SystemActor {
  readonly role: 'SYSTEM';
  readonly reason: string;
}

// ---------------------------------------------------------------- results

/**
 * Services return this rather than throwing for expected outcomes, so a handler maps a code to a
 * status and never leaks an internal message. The previous build returned `error.message` from
 * fourteen handlers, exposing Prisma's table and constraint names to the browser (D-39).
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INPUT',
  'CONFLICT',
  'RATE_LIMITED',
  'STATE_NOT_ALLOWED',
  'LIMIT_REACHED',
  'WINDOW_CLOSED',
  'ALREADY_DONE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface DomainError {
  readonly code: ErrorCode;
  /** Shown to the user. Written for them, not for a log. */
  readonly message: string;
  /** Field path for a form error, when the failure belongs to one field. */
  readonly field?: string;
  /** Never shown. Logged with the correlation id. */
  readonly detail?: string;
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: DomainError): Result<never> => ({ ok: false, error });

// ---------------------------------------------------------------- views
//
//  What a service hands back. Never a database row — a mapped shape with the hash and anything
//  else the caller has no business seeing already gone (D-12). Money is Paise; the interface
//  formats it.

export interface PersonView {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly role: C.Role;
  readonly status: C.UserStatus;
  readonly home: HomeView | null;
}

export interface HomeView {
  readonly unitId: number;
  readonly blockName: string;
  readonly label: string;
  readonly type: C.UnitType;
  readonly monthlyChargePaise: C.Paise;
}

export interface PassView {
  readonly id: number;
  readonly visitorName: string;
  readonly purpose: string;
  readonly code: string;
  readonly validOn: Date;
  readonly status: C.PassStatus;
  readonly arrivedAt: Date | null;
}

/**
 * What the gate is told. A decision with a reason, not a row — the previous endpoint returned the
 * pass regardless of status or date and the kiosk rendered it as "Valid Pre-Authorized Pass",
 * so a cancelled pass was admitted (D-40).
 */
export type GateDecision =
  | {
      readonly verdict: 'ADMIT';
      readonly passId: number;
      readonly visitorName: string;
      readonly purpose: string;
      readonly destination: string;
      readonly hostName: string;
    }
  | {
      readonly verdict: 'REFUSE';
      readonly reason: C.GateRefusalReason;
    };

export interface InvoiceView {
  readonly id: number;
  readonly period: string;
  readonly amountPaise: C.Paise;
  readonly dueOn: Date;
  readonly status: C.InvoiceStatus;
  readonly receiptNo: string | null;
  readonly paidAt: Date | null;
}

export interface ComplaintView {
  readonly id: number;
  readonly category: C.ComplaintCategory;
  readonly priority: C.ComplaintPriority;
  readonly description: string;
  readonly status: C.ComplaintStatus;
  readonly raisedAt: Date;
  readonly resolvedAt: Date | null;
  readonly reopenableUntil: Date | null;
  readonly updates: readonly {
    readonly at: Date;
    readonly by: string;
    readonly statusAfter: C.ComplaintStatus;
    readonly note: string;
  }[];
}

export interface BookingView {
  readonly id: number;
  readonly facilityName: string;
  readonly bookingDate: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: C.BookingStatus;
  readonly amountPaise: C.Paise;
}

export interface NoticeView {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly category: C.AnnouncementCategory;
  readonly pinned: boolean;
  readonly publishedAt: Date;
  readonly authorName: string;
}

/** The gate approval a resident has to answer. Drives the live surface. */
export interface WaitingVisitorView {
  readonly logId: number;
  readonly name: string;
  readonly phone: string | null;
  readonly purpose: string;
  readonly since: Date;
}

// ---------------------------------------------------------------- services

export interface AccountsService {
  /**
   * Verifies an access token against the live account: signature and expiry, then status, then
   * the password stamp. This is the per-request check — the token may be structurally valid and
   * still speak for a session that a password change or a disabling has already killed
   * (D-23, D-24).
   */
  resolveActor(accessToken: string): Promise<Result<Actor>>;

  signIn(input: C.SignInInput, meta: RequestMeta): Promise<Result<Session>>;
  signOut(refreshToken: string): Promise<Result<null>>;
  refresh(refreshToken: string, meta: RequestMeta): Promise<Result<Session>>;
  register(input: C.RegisterInput, meta: RequestMeta): Promise<Result<{ personId: number }>>;
  requestPasswordReset(input: C.RequestPasswordResetInput, meta: RequestMeta): Promise<Result<null>>;
  completePasswordReset(input: C.CompletePasswordResetInput): Promise<Result<null>>;
  me(actor: Actor): Promise<Result<PersonView>>;
  /** Kills every session, including the changer's own (D-23). */
  changePassword(
    actor: Actor,
    input: { currentPassword: string; newPassword: string },
  ): Promise<Result<null>>;
  /** Committee. Approving resolves a unit claim; declining must not leave the unit occupied (D-42). */
  decideRegistration(
    actor: Actor,
    input: C.DecideRegistrationInput,
    meta: RequestMeta,
  ): Promise<Result<PersonView>>;
}

export interface RequestMeta {
  readonly ip: string;
  readonly userAgent: string | null;
  readonly correlationId: string;
}

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly person: PersonView;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export interface VisitorsService {
  issuePass(actor: Actor, input: C.CreatePassInput): Promise<Result<PassView>>;
  cancelPass(actor: Actor, passId: number): Promise<Result<PassView>>;
  passesForHousehold(actor: Actor): Promise<Result<readonly PassView[]>>;

  /** The gate. Returns a decision, never a row, and throttled — a six-digit code is enumerable. */
  verifyCode(actor: Actor, input: C.VerifyPassInput, meta: RequestMeta): Promise<Result<GateDecision>>;
  /** Idempotent per pass: a second check-in must not create a second log row. */
  recordEntry(actor: Actor, input: { passId: number; action: 'CHECK_IN' | 'CHECK_OUT'; idempotencyKey?: string }): Promise<Result<null>>;

  logWalkIn(actor: Actor, input: C.LogWalkInInput): Promise<Result<{ logId: number }>>;
  /** Writes decidedById and decidedAt — the columns UC-05 needs and the previous build never set. */
  decideWalkIn(actor: Actor, input: { logId: number; decision: 'APPROVE' | 'REJECT' }): Promise<Result<null>>;
  waitingForHousehold(actor: Actor): Promise<Result<readonly WaitingVisitorView[]>>;
  expectedToday(actor: Actor): Promise<Result<readonly PassView[]>>;
}

export interface ComplaintsService {
  raise(actor: Actor, input: C.RaiseComplaintInput): Promise<Result<ComplaintView>>;
  forHousehold(actor: Actor): Promise<Result<readonly ComplaintView[]>>;
  forSociety(actor: Actor, filter?: { status?: C.ComplaintStatus }): Promise<Result<readonly ComplaintView[]>>;
  /** Committee. A permitted transition only, and resolvedAt survives every later update (D-20). */
  update(actor: Actor, input: C.UpdateComplaintInput): Promise<Result<ComplaintView>>;
  /** Resident, within the window, measured from resolvedAt. */
  reopen(actor: Actor, input: C.ReopenComplaintInput): Promise<Result<ComplaintView>>;
}

export interface BillingService {
  /** One transaction. Refuses outright if the period already exists, per the architecture. */
  raiseForPeriod(actor: Actor, input: C.RaiseInvoicesInput): Promise<Result<{ raised: number }>>;
  forHousehold(actor: Actor): Promise<Result<readonly InvoiceView[]>>;
  /** Scoped to the caller's own unit. Anyone could settle any invoice before (D-07). */
  pay(actor: Actor, input: C.PayInvoiceInput): Promise<Result<InvoiceView>>;
  recordOffline(actor: Actor, input: { invoiceId: number; amountPaise: C.Paise; receivedOn: string; note?: string }): Promise<Result<InvoiceView>>;
  cancel(actor: Actor, input: { invoiceId: number; reason: string }): Promise<Result<InvoiceView>>;
  /** Receipt addressed by number, not row id, so it survives a target switch. */
  receipt(actor: Actor, receiptNo: string): Promise<Result<ReceiptView>>;
  flagOverdue(actor: SystemActor, asOf: Date): Promise<Result<{ flagged: number }>>;
}

export interface ReceiptView {
  readonly receiptNo: string;
  readonly paidAt: Date;
  readonly method: C.PaymentMethod;
  readonly amountPaise: C.Paise;
  readonly amountInWords: string;
  readonly period: string;
  readonly payerName: string;
  readonly home: HomeView;
  readonly reference: string;
}

export interface FacilitiesService {
  list(actor: Actor): Promise<Result<readonly FacilityView[]>>;
  /** Slots already held are returned disabled with a reason, not rejected on submit (D-72). */
  availability(actor: Actor, input: { facilityId: number; on: string }): Promise<Result<readonly SlotView[]>>;
  request(actor: Actor, input: C.RequestBookingInput): Promise<Result<BookingView>>;
  forHousehold(actor: Actor): Promise<Result<readonly BookingView[]>>;
  cancel(actor: Actor, input: { bookingId: number }): Promise<Result<BookingView>>;
  decide(actor: Actor, input: { bookingId: number; decision: 'CONFIRM' | 'REJECT'; reason?: string }): Promise<Result<BookingView>>;
}

export interface FacilityView {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly hourlyRatePaise: C.Paise;
}

export interface SlotView {
  readonly startTime: string;
  readonly endTime: string;
  readonly available: boolean;
  readonly reason?: 'HELD' | 'OUTSIDE_HOURS' | 'PAST';
}

export interface NoticesService {
  feed(actor: Actor): Promise<Result<readonly NoticeView[]>>;
  publish(actor: Actor, input: C.PublishAnnouncementInput): Promise<Result<NoticeView>>;
  withdraw(actor: Actor, noticeId: number): Promise<Result<null>>;
}

export interface PropertyService {
  /** The only public surface: block and unit labels for registration. No charges, no occupants. */
  registrationOptions(): Promise<Result<readonly { blockId: number; blockName: string; units: readonly { unitId: number; label: string }[] }[]>>;
  blocks(actor: Actor): Promise<Result<readonly { id: number; name: string; floors: number; active: boolean; unitCount: number }[]>>;
  createBlock(actor: Actor, input: C.CreateBlockInput): Promise<Result<{ id: number }>>;
  createUnit(actor: Actor, input: C.CreateUnitInput): Promise<Result<{ id: number }>>;
  updateUnit(actor: Actor, input: C.UpdateUnitInput): Promise<Result<null>>;
}

export interface NotificationsService {
  unread(actor: Actor): Promise<Result<{ count: number; items: readonly NoticeItem[] }>>;
  markRead(actor: Actor, ids: readonly number[]): Promise<Result<null>>;
}

export interface NoticeItem {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
  readonly at: Date;
  readonly read: boolean;
}
