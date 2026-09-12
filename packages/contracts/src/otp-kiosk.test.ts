import { describe, expect, it } from 'vitest';
import { GateCode } from './schemas.js';

describe('Gate Kiosk OTP Passcode Safety & Formatting', () => {
  it('accepts valid 6-digit numeric passcodes', () => {
    expect(GateCode.safeParse('582914').success).toBe(true);
    expect(GateCode.safeParse('000000').success).toBe(true);
    expect(GateCode.safeParse('999999').success).toBe(true);
  });

  it('rejects codes that are not exactly 6 digits', () => {
    expect(GateCode.safeParse('12345').success).toBe(false);
    expect(GateCode.safeParse('1234567').success).toBe(false);
    expect(GateCode.safeParse('').success).toBe(false);
  });

  it('rejects alphanumeric or special character strings', () => {
    expect(GateCode.safeParse('58291A').success).toBe(false);
    expect(GateCode.safeParse('582-914').success).toBe(false); // un-normalized
    expect(GateCode.safeParse('abcdef').success).toBe(false);
    expect(GateCode.safeParse('58 291').success).toBe(false);
  });

  it('normalizes segmented kiosk code input (e.g. 582-914 -> 582914)', () => {
    function normalizeCode(raw: string): string {
      return raw.replace(/[^0-9]/g, '').slice(0, 6);
    }

    function formatSegmented(code: string): string {
      const clean = normalizeCode(code);
      if (clean.length <= 3) return clean;
      return `${clean.slice(0, 3)}-${clean.slice(3)}`;
    }

    expect(normalizeCode('582-914')).toBe('582914');
    expect(normalizeCode('  582 914  ')).toBe('582914');
    expect(normalizeCode('582-914999')).toBe('582914');

    expect(formatSegmented('582914')).toBe('582-914');
    expect(formatSegmented('582')).toBe('582');
    expect(formatSegmented('58')).toBe('58');
  });
});
