import type {
  BookingStatus,
  ComplaintStatus,
  InvoiceStatus,
  PassStatus,
  UserStatus,
} from './enums.js';

/**
 * Every rule the interface states, as a named constant or a transition table, in one place.
 *
 * The previous build spread these around: a maximum of six occupants was a literal in one
 * route with a comment attributing it to a use case that does not state a number (D-77); the
 * seven-day reopen window was a magic `7 * 86400000` (D-20); facility opening hours and slot
 * overlap were displayed and never enforced (D-72).
 */

// ---------------------------------------------------------------- limits

/**
 * No submitted document states this number — `docs/data-model.md` says so explicitly. Six is
 * what the previous build assumed, so it is what we keep, and the report records it as an
 * implementation decision rather than a requirement.
 */
export const MAX_OCCUPANTS_PER_UNIT = 6;

/** UC-07. Measured from the resolution timestamp, which must therefore survive later updates. */
export const COMPLAINT_REOPEN_WINDOW_DAYS = 7;

/** The submitted model stores photo keys in one column, so three is the ceiling. */
export const MAX_COMPLAINT_PHOTOS = 3;

/** UC-06 step 4: each photo is validated by type and size. Five megabytes an image. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The photo rule, stated once so the upload route, the form and the tests cannot disagree: which
 * image types are attachable (what every phone camera produces and every browser opens), the size
 * ceiling, and the ceiling per complaint. Returns the refusal a person reads, or null when the
 * file passes — never throws, because a refused photo is a form event, not an exception.
 */
export function photoVerdict(input: {
  readonly type: string;
  readonly sizeBytes: number;
  readonly alreadyAttached: number;
}): { readonly message: string } | null {
  if (ACCEPTED_PHOTO_TYPES[input.type] === undefined) {
    return { message: 'Photos have to be JPEG, PNG or WebP.' };
  }
  if (input.sizeBytes > MAX_PHOTO_BYTES) {
    return { message: 'Each photo can be at most 5 MB.' };
  }
  if (input.alreadyAttached >= MAX_COMPLAINT_PHOTOS) {
    return { message: `A complaint can carry at most ${MAX_COMPLAINT_PHOTOS} photos.` };
  }
  return null;
}

/** The image types a complaint photo may arrive as, with the extension each key ends in. */
export const ACCEPTED_PHOTO_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The shape of a stored photo key — the S3 object-key convention both deployments share. */
export const PHOTO_KEY_SHAPE = /^uploads\/complaints\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** A pass may be raised for today or up to this many days ahead. */
export const MAX_PASS_LEAD_DAYS = 30;

/** Longest single facility reservation. */
export const MAX_BOOKING_HOURS = 6;

/** How far ahead a facility may be reserved. */
export const MAX_BOOKING_LEAD_DAYS = 60;

/** Access token lifetime. Short, because a disabled account must lose access quickly (D-24). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh token lifetime. Rotated on every use. */
export const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

/** Single use, and short. */
export const PASSWORD_RESET_TTL_SECONDS = 15 * 60;

/** ADR 0001 commits to cost 12. The previous build used 10 in three places (D-43). */
export const BCRYPT_COST = 12;

export const RATE_LIMITS = {
  signIn: { attempts: 8, windowSeconds: 15 * 60 },
  register: { attempts: 5, windowSeconds: 60 * 60 },
  passwordReset: { attempts: 3, windowSeconds: 60 * 60 },
  /** A six-digit code is enumerable; the gate is the one place that must be throttled. */
  gateVerify: { attempts: 30, windowSeconds: 60 },
} as const;

// ---------------------------------------------------------------- state machines

type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * A status change is a permitted transition, not an assigned string. The previous build let an
 * administrator POST any value, including one outside the enumeration, and reset the resolution
 * timestamp on every update (D-20).
 */
export const COMPLAINT_TRANSITIONS: Transitions<ComplaintStatus> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  /** Reopening returns to OPEN, and only within the window, and only by the resident. */
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

export const BOOKING_TRANSITIONS: Transitions<BookingStatus> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED'],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export const INVOICE_TRANSITIONS: Transitions<InvoiceStatus> = {
  UNPAID: ['PAID', 'OVERDUE', 'CANCELLED'],
  OVERDUE: ['PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

export const PASS_TRANSITIONS: Transitions<PassStatus> = {
  ACTIVE: ['USED', 'EXPIRED', 'CANCELLED'],
  USED: ['EXPIRED'],
  EXPIRED: [],
  CANCELLED: [],
};

export const USER_TRANSITIONS: Transitions<UserStatus> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['DISABLED'],
  DISABLED: ['ACTIVE'],
  REJECTED: ['PENDING'],
};
