import { describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
import { billingService, paymentStreak, type StreakInvoice } from './billing.js';
import type { Clock } from './clock.js';
import type { BillingStore, StoredHome, StoredInvoice, StoredPayment } from './store.js';
import type { Actor } from './ports.js';

describe('paymentStreak IST timezone boundaries (Bug 20)', () => {
  it('preserves streak when payment is made in the afternoon/evening of the due date in IST', () => {
    // Due on 2026-09-15.
    // In UTC, 2026-09-15T14:30:00.000Z is 20:00 IST on the same day.
    // A raw string comparison '2026-09-15T14:30:00.000Z' <= '2026-09-15' failed previously.
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-15T14:30:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(1);
  });

  it('preserves streak right up to 23:59:59 IST on the due date', () => {
    // 23:59:59 IST is 18:29:59 UTC
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-15T18:29:59.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(1);
  });

  it('resets streak if payment is made at 00:01 IST the following day', () => {
    // 00:01:00 IST on 2026-09-16 is 18:31:00 UTC on 2026-09-15
    const invoices: StreakInvoice[] = [
      {
        period: '2026-09',
        status: 'PAID',
        dueOn: '2026-09-15T00:00:00.000Z',
        paidAt: '2026-09-15T18:31:00.000Z',
      },
    ];
    expect(paymentStreak(invoices)).toBe(0);
  });
});

class MockClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
}

describe('recordOffline IST date check (Bug 27)', () => {
  it('accepts cash payment for the current IST day during early morning (before 05:30 UTC)', async () => {
    // At 2026-09-07T20:30:00.000Z UTC, the time in India (UTC+5:30) is 2026-09-08 02:00:00.
    // The calendar day in IST is 2026-09-08.
    const clock = new MockClock(new Date('2026-09-07T20:30:00.000Z'));
    let storedPayment: StoredPayment | null = null;

    const fakeStore: BillingStore = {
      findHome: (unitId: number): Promise<StoredHome | null> =>
        Promise.resolve({
          unitId,
          blockId: 1,
          blockName: 'A',
          label: '101',
          type: 'FLAT_2BHK',
          monthlyChargePaise: C.paise(100000),
          active: true,
        }),
      findResidentsForUnit: () => Promise.resolve([{ id: 1, name: 'Resident', email: 'res@test.in' }]),
      billableUnits: () => Promise.resolve([]),
      countInvoicesForPeriod: () => Promise.resolve(1),
      findInvoicesForUnit: () => Promise.resolve([]),
      findInvoiceById: (id: number): Promise<StoredInvoice | null> =>
        Promise.resolve({
          id,
          unitId: 1,
          raisedById: 1,
          period: '2026-09',
          amountPaise: C.paise(100000),
          dueOn: new Date('2026-09-20T00:00:00.000Z'),
          status: 'UNPAID',
          cancelledReason: null,
          payment: null,
        }),
      findInvoicesForSociety: () => Promise.resolve([]),
      raiseInvoices: () => Promise.resolve([]),
      recordPayment: (input) => {
        storedPayment = {
          id: 10,
          invoiceId: input.invoiceId,
          recordedById: input.recordedById,
          amountPaise: input.amountPaise,
          method: input.method,
          receiptNo: 'REC-2026-09-001',
          reference: input.reference,
          paidAt: input.paidAt,
        };
        return Promise.resolve(storedPayment);
      },
      cancelInvoice: () => Promise.resolve(null),
      markInvoicesOverdue: () => Promise.resolve([]),
      findReceiptByNo: () => Promise.resolve(null),
    };

    const service = billingService({ store: fakeStore, clock });
    const adminActor: Actor = {
      userId: 99,
      name: 'Treasurer',
      role: 'A',
      unitId: null,
      email: 'treasurer@society.in',
    };

    // Committee member records cash receipt on 2026-09-08
    const res = await service.recordOffline(
      adminActor,
      C.RecordOfflinePaymentInput.parse({
        invoiceId: 1,
        amountPaise: 100000,
        method: 'CASH',
        receivedOn: '2026-09-08',
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe('PAID');
    expect(storedPayment).not.toBeNull();

    // But tomorrow in IST (2026-09-09) must still be rejected as a future date
    const futureRes = await service.recordOffline(
      adminActor,
      C.RecordOfflinePaymentInput.parse({
        invoiceId: 1,
        amountPaise: 100000,
        method: 'CASH',
        receivedOn: '2026-09-09',
      }),
    );
    expect(futureRes.ok).toBe(false);
    if (!futureRes.ok) {
      expect(futureRes.error.code).toBe('INVALID_INPUT');
      expect(futureRes.error.field).toBe('receivedOn');
    }
  });
});
