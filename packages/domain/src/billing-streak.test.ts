import { describe, expect, it } from 'vitest';
import { paymentStreak, type StreakInvoice } from './billing.js';

describe('paymentStreak', () => {
  it('returns 0 for an empty invoice history', () => {
    expect(paymentStreak([])).toBe(0);
  });

  it('counts 1 for a single invoice paid on or before due date', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-10T12:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(1);
  });

  it('counts 1 for an invoice paid on the exact due date', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-15T00:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(1);
  });

  it('returns 0 if the latest invoice was paid after the due date', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-16T00:00:00.000Z',
      },
      {
        period: '2026-08',
        status: 'PAID',
        dueOn: '2026-08-15T00:00:00.000Z',
        paidAt: '2026-08-10T00:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(0);
  });

  it('returns 0 if the latest invoice is still unpaid or overdue', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'UNPAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: null,
      },
      {
        period: '2026-08',
        status: 'PAID',
        dueOn: '2026-08-15T00:00:00.000Z',
        paidAt: '2026-08-10T00:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(0);
  });

  it('counts continuous streak across multiple past months regardless of array order', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-07',
        status: 'PAID',
        dueOn: '2026-07-15T00:00:00.000Z',
        paidAt: '2026-07-12T00:00:00.000Z',
      },
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-14T00:00:00.000Z',
      },
      {
        period: '2026-08',
        status: 'PAID',
        dueOn: '2026-08-15T00:00:00.000Z',
        paidAt: '2026-08-15T00:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(3);
  });

  it('stops counting at the first late payment in the chain', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-10T00:00:00.000Z',
      },
      {
        period: '2026-08',
        status: 'PAID',
        dueOn: '2026-08-15T00:00:00.000Z',
        paidAt: '2026-08-12T00:00:00.000Z',
      },
      {
        period: '2026-07',
        status: 'PAID',
        dueOn: '2026-07-15T00:00:00.000Z',
        paidAt: '2026-07-20T00:00:00.000Z', // LATE!
      },
      {
        period: '2026-06',
        status: 'PAID',
        dueOn: '2026-06-15T00:00:00.000Z',
        paidAt: '2026-06-10T00:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(2);
  });

  it('ignores CANCELLED invoices without breaking or adding to the streak', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-10T00:00:00.000Z',
      },
      {
        period: '2026-08-ADJUSTED',
        status: 'CANCELLED',
        dueOn: '2026-08-15T00:00:00.000Z',
        paidAt: null,
      },
      {
        period: '2026-08',
        status: 'PAID',
        dueOn: '2026-08-15T00:00:00.000Z',
        paidAt: '2026-08-12T00:00:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(2);
  });

  it('supports native Date instances as well as ISO strings', () => {
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: new Date('2026-09-15T00:00:00.000Z'),
        paidAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ];
    expect(paymentStreak(invoices)).toBe(1);
  });
});
