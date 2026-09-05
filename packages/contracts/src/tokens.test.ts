import { describe, expect, it } from 'vitest';
import {
  gatePassCode,
  hashToken,
  idempotencyKey,
  numericCode,
  paymentReference,
  receiptNumber,
  secretToken,
  tokenMatches,
} from './tokens.js';

/**
 * Anything a person could guess to gain access comes from here, so these assertions are about
 * shape and about refusal — never about a fixed value.
 *
 * The previous build derived gate codes, reset tokens and receipt numbers from `Math.random()`
 * (D-37) and stored reset tokens in the clear (D-22).
 */

/**
 * Enough draws that a per-digit generator is distinguishable from `String(randomInt(0, 1e6))`.
 * The probability that 2000 uniform six-digit codes contain none starting with a zero is
 * 0.9 ** 2000, which is about 1e-92 — this is not a flaky assertion.
 */
const DRAWS = 2000;

describe('gatePassCode', () => {
  it('is always six digits', () => {
    for (let i = 0; i < DRAWS; i += 1) {
      expect(gatePassCode()).toMatch(/^\d{6}$/);
    }
  });

  it('keeps leading zeros', () => {
    const codes: string[] = [];
    for (let i = 0; i < DRAWS; i += 1) codes.push(gatePassCode());

    // A numeric round-trip anywhere in the generator truncates these to five characters.
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
    expect(codes.every((code) => code.length === 6)).toBe(true);
  });

  it('draws from the whole space', () => {
    const codes = new Set<string>();
    for (let i = 0; i < DRAWS; i += 1) codes.add(gatePassCode());
    // A six-digit space and 2000 draws: collisions are possible but near-duplication is not.
    expect(codes.size).toBeGreaterThan(DRAWS * 0.99);
  });
});

describe('numericCode', () => {
  it('honours the requested length', () => {
    expect(numericCode(4)).toMatch(/^\d{4}$/);
    expect(numericCode(12)).toMatch(/^\d{12}$/);
  });

  it('refuses a length that is not a credential length', () => {
    expect(() => numericCode(3)).toThrow(/4-12 digits/);
    expect(() => numericCode(13)).toThrow(RangeError);
  });
});

describe('tokenMatches', () => {
  it('is true for the token that produced the stored hash', () => {
    const token = secretToken();
    expect(tokenMatches(token, hashToken(token))).toBe(true);
  });

  it('is false for a wrong token', () => {
    const stored = hashToken(secretToken());
    expect(tokenMatches(secretToken(), stored)).toBe(false);
    expect(tokenMatches('', stored)).toBe(false);
  });

  it('is false for a malformed stored hash rather than throwing', () => {
    const token = secretToken();
    for (const stored of [
      '',
      'not-hex',
      'abc',
      'z'.repeat(64),
      `${hashToken(token).slice(0, 63)}g`,
      hashToken(token).slice(0, 32),
      `${hashToken(token)}00`,
    ]) {
      expect(tokenMatches(token, stored)).toBe(false);
    }
  });

  it('never stores the token itself', () => {
    const token = secretToken();
    const stored = hashToken(token);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('receiptNumber', () => {
  it('pads the sequence to five digits', () => {
    expect(receiptNumber('2026-09', 42)).toBe('REC-2026-09-00042');
    expect(receiptNumber('2026-09', 1)).toBe('REC-2026-09-00001');
    expect(receiptNumber('2026-12', 99_999)).toBe('REC-2026-12-99999');
  });

  it('rejects a period that is not a real YYYY-MM', () => {
    for (const period of ['2026-13', '2026-00', '2026-9', '26-09', '2026/09', '', 'September']) {
      expect(() => receiptNumber(period, 1)).toThrow(/Period must be YYYY-MM/);
    }
  });

  it('rejects a sequence outside the space it pads', () => {
    expect(() => receiptNumber('2026-09', 0)).toThrow(/Sequence out of range/);
    expect(() => receiptNumber('2026-09', -1)).toThrow(RangeError);
    expect(() => receiptNumber('2026-09', 1.5)).toThrow(RangeError);
    expect(() => receiptNumber('2026-09', 100_000)).toThrow(RangeError);
  });
});

describe('references', () => {
  it('produce an opaque payment reference that does not announce a simulation', () => {
    const reference = paymentReference();
    // 10 to 12 characters, not a fixed 12: `.replace(/[-_]/g, '')` deletes the two non-alphanumeric
    // base64url characters instead of substituting them, so the length varies with the draw. The
    // uniqueness the schema needs is unaffected; noted for the contracts owner.
    expect(reference).toMatch(/^PAY[0-9A-Z]{10,12}$/);
    // D-54: the decision that no gateway is involved lives in the ADR, not in a reference string.
    expect(reference).not.toMatch(/SIM|MOCK|DEMO|TEST/);
    expect(paymentReference()).not.toBe(reference);
  });

  it('produce an idempotency key of the length the contract validates', () => {
    // PayInvoiceInput and RecordEntryInput both declare `z.string().length(32)`.
    expect(idempotencyKey()).toHaveLength(32);
    expect(idempotencyKey()).not.toBe(idempotencyKey());
  });

  it('produce a URL-safe secret token', () => {
    const token = secretToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // CompletePasswordResetInput requires at least 20 characters.
    expect(token.length).toBeGreaterThanOrEqual(20);
  });
});
