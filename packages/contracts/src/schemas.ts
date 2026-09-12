import { z } from 'zod';
import {
  ANNOUNCEMENT_CATEGORIES,
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_STATUSES,
  PAYMENT_METHODS,
  UNIT_TYPES,
} from './enums.js';

/**
 * One schema per boundary, shared by the handler and the form, so client and server validation
 * cannot disagree. The previous build had Zod as a dependency and imported it nowhere; bodies
 * were destructured and used raw, so a non-string email was a 500 (D-39).
 */

// ---------------------------------------------------------------- primitives

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

/** Indian mobile: optional +91, optional separators, ten digits starting 6-9. Stored as +91XXXXXXXXXX. */
export const Phone = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s()-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^(?:\+91)?[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number')
      .transform((v) => (v.startsWith('+91') ? v : `+91${v}`)),
  );

/**
 * The policy, in one place. `minLength={6}` on the client with no server rule at all was the
 * previous state (D-71).
 */
export const Password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That is longer than we can store')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), 'Mix upper and lower case')
  .refine((v) => /\d/.test(v) || /[^A-Za-z0-9]/.test(v), 'Include a number or a symbol')
  .refine((v) => !/^(?:password|oneresi|qwerty|12345)/i.test(v), 'Choose something less common');

export const PersonName = z.string().trim().min(2, 'Enter a full name').max(120);

/** A billing period. `YYYY-MM`, and the month has to be a month. */
export const Period = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a period like 2026-09');

/** A calendar date with no time component, so it means the same in every timezone. */
export const CalendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-15')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'That date does not exist');

/** `HH:MM`, 24-hour, zero padded — so lexical order is chronological order. */
export const ClockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use a time like 18:30');

export const Money = z
  .number()
  .int('Amounts are whole paise')
  .nonnegative()
  .max(1_000_000_000_00);

export const GateCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'A pass code is six digits');

export const UnitLabel = z
  .string()
  .trim()
  .min(1, 'Enter your flat or plot number')
  .max(20)
  .transform((v) => v.toUpperCase());

/**
 * The push service's own URL for one browser's subscription. HTTPS only: the POST this address
 * names carries the message's encryption, and a plain-http endpoint is a downgrade the
 * subscription protocol does not permit.
 */
export const PushEndpoint = z
  .string()
  .trim()
  .max(2048, 'That push endpoint is too long')
  .url('That is not a valid push endpoint')
  .refine((v) => v.startsWith('https://'), 'Push endpoints must be HTTPS');

/**
 * The client's public key, exactly as the browser produced it: 65 bytes on every current browser,
 * so 87 characters of base64url. The browser generates these strings; a person never types them,
 * so the rules are structural.
 */
export const PushP256dh = z
  .string()
  .trim()
  .min(43, 'That public key is too short')
  .max(200, 'That public key is too long')
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, 'The public key is not base64url');

/** The subscription's auth secret: 16 bytes, so 22 characters of base64url. */
export const PushAuth = z
  .string()
  .trim()
  .min(16, 'That auth key is too short')
  .max(64, 'That auth key is too long')
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, 'The auth key is not base64url');

const Id = z.number().int().positive();

/** A window where the end must be after the start. Used by bookings; enforced, not displayed (D-72). */
export const TimeWindow = z
  .object({ startTime: ClockTime, endTime: ClockTime })
  .refine((w) => w.endTime > w.startTime, {
    message: 'The end time has to be after the start time',
    path: ['endTime'],
  });

// ---------------------------------------------------------------- accounts

export const SignInInput = z.object({
  email: Email,
  password: z.string().min(1, 'Enter your password'),
});

/**
 * Registration claims a home; it does not create one. The applicant can neither create a block
 * or unit nor set a charge — both were possible from this unauthenticated endpoint, and the
 * charge is what every invoice snapshots (D-04).
 *
 * If their unit is not on the list they describe it, and an administrator resolves the claim
 * during approval.
 */
export const RegisterInput = z.object({
  name: PersonName,
  email: Email,
  phone: Phone,
  password: Password,
  home: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), unitId: Id }),
    z.object({
      kind: z.literal('claim'),
      blockName: z.string().trim().min(1).max(80),
      unitLabel: UnitLabel,
      unitType: z.enum(UNIT_TYPES),
      note: z.string().trim().max(280).optional(),
    }),
  ]),
});

export const RequestPasswordResetInput = z.object({ email: Email });

export const CompletePasswordResetInput = z.object({
  token: z.string().min(20),
  password: Password,
});

export const DecideRegistrationInput = z.object({
  userId: Id,
  decision: z.enum(['APPROVE', 'DECLINE']),
  reason: z.string().trim().max(280).optional(),
});

// ---------------------------------------------------------------- visitors

export const CreatePassInput = z.object({
  visitorName: PersonName,
  purpose: z.string().trim().min(2).max(120),
  /** Today or later. A pass valid last week was previously accepted (D-72). */
  validDate: CalendarDate,
});

export const VerifyPassInput = z.object({ code: GateCode });

export const RecordEntryInput = z.object({
  passId: Id,
  action: z.enum(['CHECK_IN', 'CHECK_OUT']),
  idempotencyKey: z.string().length(32).optional(),
});

export const LogWalkInInput = z.object({
  unitId: Id,
  visitorName: PersonName,
  phone: Phone.optional(),
  purpose: z.string().trim().min(2).max(120),
  /**
   * A guard may admit without waiting, but it is an exception that names itself and is
   * attributed. Previously an unlabelled boolean with no audit (D-21).
   */
  guardOverride: z
    .object({ reason: z.string().trim().min(4).max(200) })
    .optional(),
});

export const DecideWalkInInput = z.object({
  logId: Id,
  decision: z.enum(['APPROVE', 'REJECT']),
});

// ---------------------------------------------------------------- complaints

export const RaiseComplaintInput = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  priority: z.enum(COMPLAINT_PRIORITIES).default('MEDIUM'),
  description: z.string().trim().min(10, 'Describe the problem in a sentence or two').max(2000),
  /** S3 object keys, produced by a presigned upload. At most three, per the submitted model. */
  photoKeys: z.array(z.string().min(1).max(200)).max(3).default([]),
});

export const UpdateComplaintInput = z.object({
  complaintId: Id,
  status: z.enum(COMPLAINT_STATUSES),
  note: z.string().trim().min(4, 'Say what changed').max(1000),
});

export const ReopenComplaintInput = z.object({
  complaintId: Id,
  reason: z.string().trim().min(10, 'Tell us what is still wrong').max(1000),
});

// ---------------------------------------------------------------- billing

export const RaiseInvoicesInput = z.object({
  period: Period,
  dueDate: CalendarDate,
});

export const PayInvoiceInput = z.object({
  invoiceId: Id,
  method: z.enum(PAYMENT_METHODS).default('UPI'),
  idempotencyKey: z.string().length(32).optional(),
});

/** An administrator recording money received outside the system. ADR 0002 keeps this path. */
export const RecordOfflinePaymentInput = z.object({
  invoiceId: Id,
  amountPaise: Money,
  method: z.literal('CASH'),
  receivedOn: CalendarDate,
  note: z.string().trim().max(280).optional(),
});

export const CancelInvoiceInput = z.object({
  invoiceId: Id,
  reason: z.string().trim().min(4).max(280),
});

// ---------------------------------------------------------------- facilities

export const RequestBookingInput = z
  .object({
    facilityId: Id,
    bookingDate: CalendarDate,
  })
  .and(TimeWindow);

// ---------------------------------------------------------------- facility management (UC-22)

/** A new amenity: name, what it is, when it is open, and the hourly charge. The hours are a
 * window whose end must be after its start — the same rule every booking window keeps. */
export const CreateFacilityInput = z
  .object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().min(4).max(500),
    opensAt: ClockTime,
    closesAt: ClockTime,
    hourlyRatePaise: Money,
  })
  .refine((f) => f.closesAt > f.opensAt, {
    message: 'The facility has to close after it opens',
    path: ['closesAt'],
  });

/** An edit: every field optional, the id names the facility, `active` retires or restores it. */
export const UpdateFacilityInput = z.object({
  facilityId: Id,
  name: z.string().trim().min(3).max(80).optional(),
  description: z.string().trim().min(4).max(500).optional(),
  opensAt: ClockTime.optional(),
  closesAt: ClockTime.optional(),
  hourlyRatePaise: Money.optional(),
  active: z.boolean().optional(),
}).refine(
  (input) =>
    input.name !== undefined ||
    input.description !== undefined ||
    input.opensAt !== undefined ||
    input.closesAt !== undefined ||
    input.hourlyRatePaise !== undefined ||
    input.active !== undefined,
  { message: 'Nothing to change' },
).refine(
  // A hours edit must arrive as a coherent pair, or leave both alone — half a window is how a
  // facility ends up closing before it opens.
  (input) => (input.opensAt === undefined) === (input.closesAt === undefined),
  { message: 'Change both opening and closing time together', path: ['closesAt'] },
);

export const DecideBookingInput = z.object({
  bookingId: Id,
  decision: z.enum(['CONFIRM', 'REJECT']),
  reason: z.string().trim().max(280).optional(),
});

export const CancelBookingInput = z.object({ bookingId: Id });

// ---------------------------------------------------------------- announcements

export const PublishAnnouncementInput = z.object({
  title: z.string().trim().min(4).max(140),
  body: z.string().trim().min(10).max(5000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default('GENERAL'),
  pinned: z.boolean().default(false),
  /** Restored to the model — UC-24 requires announcements to expire (D-46). */
  expiresOn: CalendarDate.optional(),
  attachmentKey: z.string().min(1).max(200).optional(),
});

// ---------------------------------------------------------------- push subscriptions

/**
 * What a browser's `pushManager.subscribe()` hands over, verbatim in shape. The endpoint is the
 * natural key: a re-subscription (the browser rotated its keys) refreshes the one row it names
 * rather than adding a second one for the same device.
 *
 * `expirationTime` is accepted because the browser sends it, and not stored: the push service
 * announces the real expiry by answering 410 when the subscription dies, which is the only
 * source worth trusting — a promised expiry time that comes and goes would have subscriptions
 * retired early or zombie rows kept alive.
 */
export const PushSubscribeInput = z.object({
  endpoint: PushEndpoint,
  keys: z.object({
    p256dh: PushP256dh,
    auth: PushAuth,
  }),
  expirationTime: z.number().optional(),
});

/** The one subscription being retired, named by the only stable handle there is: its endpoint. */
export const PushUnsubscribeInput = z.object({ endpoint: PushEndpoint });

// ---------------------------------------------------------------- admin: property

export const CreateBlockInput = z.object({
  name: z.string().trim().min(1).max(80),
  floors: z.number().int().min(1).max(100).default(1),
});

export const CreateUnitInput = z.object({
  blockId: Id,
  unitLabel: UnitLabel,
  type: z.enum(UNIT_TYPES),
  monthlyChargePaise: Money,
});

export const UpdateUnitInput = z.object({
  unitId: Id,
  type: z.enum(UNIT_TYPES).optional(),
  monthlyChargePaise: Money.optional(),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------- reports

export const ReportQuery = z.object({
  kind: z.enum(['dues', 'complaints', 'visitors']),
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
});

// ---------------------------------------------------------------- inferred types
//
//  Every schema gets its inferred type under the same name, so a service signature can say
//  `input: CreateUnitInput` and mean the parsed shape. A schema without one here is a schema
//  nothing can be typed against.

export type SignInInput = z.infer<typeof SignInInput>;
export type RegisterInput = z.infer<typeof RegisterInput>;
export type RequestPasswordResetInput = z.infer<typeof RequestPasswordResetInput>;
export type CompletePasswordResetInput = z.infer<typeof CompletePasswordResetInput>;
export type DecideRegistrationInput = z.infer<typeof DecideRegistrationInput>;

export type CreatePassInput = z.infer<typeof CreatePassInput>;
export type VerifyPassInput = z.infer<typeof VerifyPassInput>;
export type RecordEntryInput = z.infer<typeof RecordEntryInput>;
export type LogWalkInInput = z.infer<typeof LogWalkInInput>;
export type DecideWalkInInput = z.infer<typeof DecideWalkInInput>;

export type RaiseComplaintInput = z.infer<typeof RaiseComplaintInput>;
export type UpdateComplaintInput = z.infer<typeof UpdateComplaintInput>;
export type ReopenComplaintInput = z.infer<typeof ReopenComplaintInput>;

export type RaiseInvoicesInput = z.infer<typeof RaiseInvoicesInput>;
export type PayInvoiceInput = z.infer<typeof PayInvoiceInput>;
export type RecordOfflinePaymentInput = z.infer<typeof RecordOfflinePaymentInput>;
export type CancelInvoiceInput = z.infer<typeof CancelInvoiceInput>;

export type RequestBookingInput = z.infer<typeof RequestBookingInput>;
export type DecideBookingInput = z.infer<typeof DecideBookingInput>;
export type CancelBookingInput = z.infer<typeof CancelBookingInput>;

export type PublishAnnouncementInput = z.infer<typeof PublishAnnouncementInput>;

export type PushSubscribeInput = z.infer<typeof PushSubscribeInput>;
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInput>;

export type CreateBlockInput = z.infer<typeof CreateBlockInput>;
export type CreateUnitInput = z.infer<typeof CreateUnitInput>;
export type UpdateUnitInput = z.infer<typeof UpdateUnitInput>;

export type ReportQuery = z.infer<typeof ReportQuery>;
export type TimeWindow = z.infer<typeof TimeWindow>;
export type CreateFacilityInput = z.infer<typeof CreateFacilityInput>;
export type UpdateFacilityInput = z.infer<typeof UpdateFacilityInput>;
