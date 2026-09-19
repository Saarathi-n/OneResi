import { fail, type DomainError, type Result } from './ports.js';

/**
 * The named failures a service may return, so a handler maps a code to a status and a message
 * written for the person reading it. Nothing here exposes an internal detail.
 *
 * The previous build ended fourteen handlers with `{ error: error.message }`, which put Prisma's
 * table names, column names and constraint names in the browser, and made a validation failure
 * indistinguishable from an internal one — both arrived as 500 (D-39).
 */

export const errors = {
  unauthenticated: (): Result<never> =>
    fail({ code: 'UNAUTHENTICATED', message: 'Please sign in again.' }),

  /** Sign-in's refusal. Deliberately covers both a wrong email and a wrong password (D-39). */
  badCredentials: (): Result<never> =>
    fail({ code: 'UNAUTHENTICATED', message: 'That email and password do not match our records.' }),

  forbidden: (what = 'do that'): Result<never> =>
    fail({ code: 'FORBIDDEN', message: `You do not have permission to ${what}.` }),

  notFound: (what: string): Result<never> =>
    fail({ code: 'NOT_FOUND', message: `We could not find that ${what}.` }),

  invalid: (message: string, field?: string): Result<never> =>
    fail({ code: 'INVALID_INPUT', message, ...(field === undefined ? {} : { field }) }),

  conflict: (message: string, field?: string): Result<never> =>
    fail({ code: 'CONFLICT', message, ...(field === undefined ? {} : { field }) }),

  rateLimited: (retryAfterSeconds: number): Result<never> =>
    fail({
      code: 'RATE_LIMITED',
      message: `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute${
        retryAfterSeconds > 60 ? 's' : ''
      }.`,
    }),

  stateNotAllowed: (message: string): Result<never> => fail({ code: 'STATE_NOT_ALLOWED', message }),

  limitReached: (message: string): Result<never> => fail({ code: 'LIMIT_REACHED', message }),

  windowClosed: (message: string): Result<never> => fail({ code: 'WINDOW_CLOSED', message }),

  alreadyDone: (message: string): Result<never> => fail({ code: 'ALREADY_DONE', message }),

  /** For a failure with no expected cause. The detail is logged, never returned. */
  unexpected: (detail: unknown): Result<never> =>
    fail({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      detail: detail instanceof Error ? detail.message : String(detail),
    }),
} as const;

/** HTTP status per code. The only place the mapping lives. */
export const STATUS_FOR: Record<DomainError['code'], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  STATE_NOT_ALLOWED: 409,
  LIMIT_REACHED: 409,
  WINDOW_CLOSED: 410,
  ALREADY_DONE: 409,
  INTERNAL_ERROR: 500,
};
