import { describe, expect, it } from 'vitest';
import { paise, formatMoney, moneyInWords } from './money.js';

describe('Receipt Breakdown & Money Safety', () => {
  it('validates receipt line-item arithmetic: breakdown matches total', () => {
    const serviceCharge = paise(200000); // ₹2,000
    const sinkingFund = paise(100000);   // ₹1,000
    const waterCharge = paise(50000);    // ₹500
    const total = paise(350000);         // ₹3,500

    expect(serviceCharge + sinkingFund + waterCharge).toBe(total);
    expect(formatMoney(total)).toBe('₹3,500.00');
    expect(moneyInWords(total)).toBe('Three thousand five hundred rupees only');
  });

  it('formats zero paise cleanly without crashing', () => {
    const zero = paise(0);
    expect(formatMoney(zero)).toBe('₹0.00');
    expect(formatMoney(zero, { compact: true })).toBe('₹0');
    expect(moneyInWords(zero)).toBe('Zero rupees only');
  });

  it('formats small amounts with paise fractions accurately', () => {
    const small = paise(150); // ₹1.50
    expect(formatMoney(small)).toBe('₹1.50');
    expect(moneyInWords(small)).toBe('One rupees and fifty paise only');
  });

  it('formats large society collections (lakhs & crores) accurately', () => {
    const lakhAmount = paise(48250000); // ₹4,82,500.00
    expect(formatMoney(lakhAmount)).toBe('₹4,82,500.00');
    expect(moneyInWords(lakhAmount)).toBe('Four lakh eighty-two thousand five hundred rupees only');

    const croreAmount = paise(1250000000); // ₹1,25,00,000.00 (1.25 crore)
    expect(formatMoney(croreAmount)).toBe('₹1,25,00,000.00');
    expect(moneyInWords(croreAmount)).toBe('One crore twenty-five lakh rupees only');
  });

  it('validates standard receipt number regex format (REC-YYYY-MM-00000)', () => {
    const receiptRegex = /^REC-\d{4}-\d{2}-\d{5}$/;
    expect(receiptRegex.test('REC-2026-09-00042')).toBe(true);
    expect(receiptRegex.test('REC-2026-09-00001')).toBe(true);
    expect(receiptRegex.test('REC-2026-12-99999')).toBe(true);

    expect(receiptRegex.test('REC-26-9-42')).toBe(false);
    expect(receiptRegex.test('INVOICE-001')).toBe(false);
    expect(receiptRegex.test('')).toBe(false);
  });
});
