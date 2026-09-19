import { describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';

describe('Onboarding & Customer Tracking Validation Safety', () => {
  function passwordScore(value: string): number {
    if (!value || value.length === 0) return 0;
    let score = 0;
    if (value.length >= 10) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
    if (!/^(?:password|oneresi|qwerty|12345)/i.test(value)) score += 1;
    return score;
  }

  it('rates password strength accurately across edge cases', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('short')).toBe(1);
    expect(passwordScore('password12345')).toBe(2); // flagged for common prefix
    expect(passwordScore('GulmoharCourt2026!')).toBe(4); // strong!
  });

  it('validates 10-digit Indian phone numbers starting 6-9 strictly', () => {
    expect(C.Phone.safeParse('9847051201').success).toBe(true);
    expect(C.Phone.safeParse('8123456789').success).toBe(true);
    expect(C.Phone.safeParse('7000000000').success).toBe(true);
    expect(C.Phone.safeParse('6999999999').success).toBe(true);

    // Invalid numbers
    expect(C.Phone.safeParse('5123456789').success).toBe(false); // starts with 5
    expect(C.Phone.safeParse('984705120').success).toBe(false);   // 9 digits
    expect(C.Phone.safeParse('98470512011').success).toBe(false); // 11 digits
    expect(C.Phone.safeParse('abcdefghij').success).toBe(false);
  });

  it('validates email addresses strictly', () => {
    expect(C.Email.safeParse('aarav.sharma@example.com').success).toBe(true);
    expect(C.Email.safeParse('resident+flat101@oneresi.in').success).toBe(true);

    expect(C.Email.safeParse('not-an-email').success).toBe(false);
    expect(C.Email.safeParse('@missing-user.com').success).toBe(false);
    expect(C.Email.safeParse('').success).toBe(false);
  });

  it('validates unit label format', () => {
    expect(C.UnitLabel.safeParse('A-101').success).toBe(true);
    expect(C.UnitLabel.safeParse('Villa 4').success).toBe(true);
    expect(C.UnitLabel.safeParse('PH-02').success).toBe(true);

    expect(C.UnitLabel.safeParse('').success).toBe(false);
  });
});
