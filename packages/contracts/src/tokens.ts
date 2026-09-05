import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Anything a person could guess to gain access comes from here.
 *
 * The previous build derived gate codes, password reset tokens, receipt numbers and payment
 * order ids from `Math.random()` (D-37). A six-digit gate code is a bearer credential and a
 * reset token is a password equivalent; neither may come from a predictable source.
 */

/** Digits only, cryptographically drawn, uniform. Leading zeros are kept. */
export function numericCode(digits: number): string {
  if (digits < 4 || digits > 12) {
    throw new RangeError(`Code length must be 4-12 digits, received ${digits}`);
  }
  let out = '';
  for (let i = 0; i < digits; i += 1) out += String(randomInt(0, 10));
  return out;
}

/** The gate pass code. Six digits, as specified. */
export function gatePassCode(): string {
  return numericCode(6);
}

/**
 * A URL-safe secret. Returned in the clear once, for the link; only `hashToken(value)` is
 * ever stored.
 */
export function secretToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison, so a stored-hash check cannot be timed. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * A receipt number is a reference a resident may quote and an auditor may look up, so it must
 * be unique by construction rather than by luck. `REC-2026-09-00042` — period plus a
 * per-period sequence supplied by the caller inside the same transaction as the payment.
 *
 * The previous build used four random digits against a UNIQUE column, so a collision was a
 * 500 rather than a retry (D-37).
 */
export function receiptNumber(period: string, sequence: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new RangeError(`Period must be YYYY-MM, received "${period}"`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99_999) {
    throw new RangeError(`Sequence out of range: ${sequence}`);
  }
  return `REC-${period}-${String(sequence).padStart(5, '0')}`;
}

/**
 * The reference ADR 0002 retains in place of a gateway order id. Opaque, unique, and it does
 * not announce itself as a simulation — the decision that no gateway is involved lives in the
 * ADR, not in the interface (D-54).
 */
export function paymentReference(): string {
  return `PAY${randomBytes(9).toString('base64url').replace(/[-_]/g, '').toUpperCase().slice(0, 12)}`;
}

/**
 * An idempotency key for a mutation the offline queue may replay. Two deliveries of the same
 * intent must produce one row; see docs/plan/05-testing.md.
 */
export function idempotencyKey(): string {
  return randomBytes(16).toString('hex');
}
