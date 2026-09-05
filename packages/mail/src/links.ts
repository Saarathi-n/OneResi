import { RenderError } from './errors.js';
import { appOrigin } from './env.js';
import type { RenderContext } from './types.js';

/**
 * Every path a message can link to, in one file, and one function that makes a path absolute.
 *
 * Two reasons it is centralised. A link in an email cannot be relative — there is no page for a mail
 * client to resolve it against — and the origin has to come from configuration, because the previous
 * build hardcoded `http://localhost:3000` in six templates (D-22). And when the route structure
 * settles, this is the only file that changes.
 *
 * Route shape follows docs/plan/02-architecture.md: the marketing site and the committee desk are
 * served from `/` and `/admin/*`, the installable resident app from `/a/*`.
 */

export const PATHS = {
  signIn: '/sign-in',
  /** UC-03's page, which the previous build linked to without ever building (D-22). */
  resetPassword: (token: string) => `/reset-password?token=${encodeURIComponent(token)}`,

  /** Committee desk. */
  registrationReview: (applicantId: number) => `/admin/residents/${applicantId}`,
  bookingReview: (bookingId: number) => `/admin/bookings/${bookingId}`,

  /** Resident app. */
  home: '/a',
  dues: '/a/dues',
  invoice: (invoiceId: number) => `/a/dues/${invoiceId}`,
  receipt: (receiptNo: string) => `/a/receipts/${encodeURIComponent(receiptNo)}`,
  complaint: (complaintId: number) => `/a/complaints/${complaintId}`,
  booking: (bookingId: number) => `/a/bookings/${bookingId}`,
  notice: (announcementId: number) => `/a/notices/${announcementId}`,
  /** Where a resident answers a visitor waiting at the gate. */
  waitingVisitors: '/a/visitors',
  gateLog: '/a/visitors/log',
} as const;

/**
 * A path becomes a URL here and nowhere else. Rejects anything that is not a rooted path, so a
 * template cannot smuggle in a host of its own — including through the protocol-relative `//host`
 * form, which `new URL` would happily resolve to another origin.
 */
export function absoluteUrl(path: string, origin: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new RenderError(
      `A mail link must be a rooted path so it can be resolved against APP_ORIGIN, received "${path}"`,
    );
  }
  return new URL(path, origin).toString();
}

export interface RenderOptions {
  /** Overrides `APP_ORIGIN`. The worker passes nothing; tests and previews pass their own. */
  readonly origin?: string;
}

/**
 * Resolves the origin once per render, so a message cannot end up with links to two different hosts.
 */
export function resolveOrigin(options: RenderOptions = {}): string {
  return options.origin === undefined ? appOrigin() : new URL(options.origin).origin;
}

export function contextFor(origin: string): RenderContext {
  return { url: (path) => absoluteUrl(path, origin) };
}

export function renderContext(options: RenderOptions = {}): RenderContext {
  return contextFor(resolveOrigin(options));
}
