import { describe, expect, it } from 'vitest';
import {
  ZERO,
  addMoney,
  formatMoney,
  moneyInWords,
  paise,
  rupees,
  subtractMoney,
  timesMoney,
} from './money.js';

/**
 * Money is an integer count of paise, and the only place a fraction exists is `formatMoney`.
 *
 * The previous build made the same amount a Decimal in the database, a string over the wire and a
 * float in the client, then summed the floats to show outstanding dues (D-50). Every assertion
 * below exists to make that impossible to reintroduce quietly.
 */

describe('rupees', () => {
  it('converts whole rupees to paise', () => {
    expect(rupees(3500)).toBe(350_000);
    expect(rupees(0)).toBe(0);
    expect(rupees(1)).toBe(100);
  });

  it('accepts an amount that lands exactly on a paisa', () => {
    expect(rupees(3500.5)).toBe(350_050);
    expect(rupees(0.01)).toBe(1);
    // 0.07 * 100 is 7.000000000000001 in binary floating point. Rounding has to absorb that.
    expect(rupees(0.07)).toBe(7);
    expect(rupees(1234.56)).toBe(123_456);
  });

  it('refuses an amount finer than one paisa', () => {
    expect(() => rupees(3500.005)).toThrow(RangeError);
    expect(() => rupees(0.001)).toThrow(/finer than one paisa/);
    expect(() => rupees(1 / 3)).toThrow(RangeError);
  });

  it('refuses an amount outside the range a society charge can be', () => {
    expect(() => rupees(-1)).toThrow(RangeError);
    // MAX_PAISE is 100 crore rupees. One rupee past it is a typo, not a charge.
    expect(() => rupees(1_000_000_001)).toThrow(/out of range/);
  });
});

describe('paise', () => {
  it('takes integers only', () => {
    expect(paise(350_000)).toBe(350_000);
    expect(() => paise(1.5)).toThrow(/whole number of paise/);
    expect(() => paise(Number.NaN)).toThrow(RangeError);
    expect(() => paise(-1)).toThrow(RangeError);
  });
});

describe('integer arithmetic', () => {
  it('stays integral and refuses to go negative', () => {
    expect(addMoney(rupees(3500), rupees(4800))).toBe(830_000);
    expect(addMoney()).toBe(0);
    expect(subtractMoney(rupees(4800), rupees(3500))).toBe(130_000);
    // An overpayment is a bug upstream, not a negative balance to render.
    expect(() => subtractMoney(rupees(3500), rupees(4800))).toThrow(RangeError);
  });

  it('multiplies by a count, never by a fraction', () => {
    expect(timesMoney(rupees(150), 3)).toBe(45_000);
    expect(timesMoney(rupees(150), 0)).toBe(0);
    expect(() => timesMoney(rupees(150), 1.5)).toThrow(/non-negative integer/);
    expect(() => timesMoney(rupees(150), -1)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  it('renders rupees with two decimal places and Indian grouping', () => {
    expect(formatMoney(rupees(3500))).toBe('₹3,500.00');
    expect(formatMoney(ZERO)).toBe('₹0.00');
    expect(formatMoney(paise(480_050))).toBe('₹4,800.50');
    // Indian grouping: two digits per group above the first thousand.
    expect(formatMoney(rupees(1_234_567))).toBe('₹12,34,567.00');
  });

  it('drops the decimals only when asked and only when the amount is round', () => {
    expect(formatMoney(rupees(3500), { compact: true })).toBe('₹3,500');
    expect(formatMoney(paise(350_050), { compact: true })).toBe('₹3,500.50');
  });
});

describe('moneyInWords', () => {
  it('handles zero', () => {
    expect(moneyInWords(ZERO)).toBe('Zero rupees only');
  });

  it('handles paise', () => {
    expect(moneyInWords(paise(50))).toBe('Zero rupees and fifty paise only');
    expect(moneyInWords(paise(480_050))).toBe(
      'Four thousand eight hundred rupees and fifty paise only',
    );
    // Wording of a single paisa is not asserted verbatim: the implementation says "one paise".
    expect(moneyInWords(paise(1))).toMatch(/^Zero rupees and one paise only$/);
  });

  it('handles the thousand and lakh boundaries', () => {
    expect(moneyInWords(rupees(99_999))).toBe(
      'Ninety-nine thousand nine hundred and ninety-nine rupees only',
    );
    expect(moneyInWords(rupees(100_000))).toBe('One lakh rupees only');
    expect(moneyInWords(rupees(100_001))).toBe('One lakh one rupees only');
  });

  it('handles the crore boundary', () => {
    expect(moneyInWords(rupees(9_999_999))).toBe(
      'Ninety-nine lakh ninety-nine thousand nine hundred and ninety-nine rupees only',
    );
    expect(moneyInWords(rupees(10_000_000))).toBe('One crore rupees only');
    expect(moneyInWords(rupees(123_456_789))).toBe(
      'Twelve crore thirty-four lakh fifty-six thousand seven hundred and eighty-nine rupees only',
    );
  });

  it('handles the largest amount the type permits', () => {
    expect(moneyInWords(paise(1_000_000_000_00))).toBe('One hundred crore rupees only');
  });

  it('always ends in a form a receipt can print', () => {
    for (const amount of [0, 1, 99, 100, 12_345, 1_00_00_000, 98_76_54_321]) {
      expect(moneyInWords(paise(amount))).toMatch(/^[A-Z].* only$/);
    }
  });
});
