import { beforeAll, describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import type { OutboxEventInput } from '@oneresi/domain';
import type { Db } from '../client.js';
import { billingStore } from './billing.js';

/**
 * The Prisma truth for BillingStore: the census, the all-or-nothing run (D-17), the receipt
 * number allocated inside the payment transaction (D-37), the guarded cancellation, and the one
 * overdue rule the scheduled job reuses (D-36).
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}
interface Fixtures {
  readonly aBlock: (db: Db, name?: string) => Promise<{ id: number; name: string }>;
  readonly aUnit: (
    db: Db,
    blockId: number,
    overrides?: { label?: string; type?: string; monthlyChargePaise?: number },
  ) => Promise<{ id: number }>;
  readonly aUser: (
    db: Db,
    overrides?: { role?: string; status?: string; unitId?: number; email?: string },
  ) => Promise<{ id: number; name: string }>;
  readonly onDay: (iso: string) => Date;
}

const HARNESS = '../../../../test/helpers/database.js';
const FIXTURES = '../../../../test/helpers/fixtures.js';

const { testDatabase } = (await import(HARNESS)) as Harness;
const { aBlock, aUnit, aUser, onDay } = (await import(FIXTURES)) as Fixtures;

let db: Db;

beforeAll(async () => {
  db = (await testDatabase()).db;
});

let eventCounter = 0;
function anEvent(type: OutboxEventInput['type']): OutboxEventInput {
  eventCounter += 1;
  return {
    type,
    channel: 'EMAIL',
    payload: { unitId: 1, amountPaise: 0 },
    correlationId: `billing-${eventCounter}`,
  };
}

/** A home someone lives in, with the default charge, and its resident. */
async function aBillableHome() {
  const block = await aBlock(db);
  const unit = await aUnit(db, block.id);
  const resident = await aUser(db, { status: 'ACTIVE', unitId: unit.id });
  const committee = await aUser(db, { role: 'A', status: 'ACTIVE' });
  return { block, unit, resident, committee };
}

describe('billableUnits', () => {
  it('lists active units with a charge, and only those', async () => {
    const store = billingStore(db);
    const home = await aBillableHome();
    const otherBlock = await aBlock(db);
    await aUnit(db, otherBlock.id, { monthlyChargePaise: 0 });
    const retired = await aUnit(db, otherBlock.id);
    await db.unit.update({ where: { id: retired.id }, data: { active: false } });

    const census = await store.billableUnits();
    const mine = census.find((entry) => entry.unitId === home.unit.id);
    expect(mine).toBeDefined();
    expect(mine?.monthlyChargePaise).toBe(C.rupees(3500));
    expect(mine?.blockName).toBe(home.block.name);
    expect(mine?.label).toBe(
      (await db.unit.findUniqueOrThrow({ where: { id: home.unit.id } })).label,
    );
    // A unit with nothing to collect is not in the census, and neither is a retired one.
    expect(census.some((entry) => entry.unitId === retired.id)).toBe(false);
    const zeroCharge = census.filter(
      (entry) => entry.monthlyChargePaise === 0,
    );
    expect(zeroCharge).toHaveLength(0);
  });
});

describe('raiseInvoices', () => {
  it('raises a period in one transaction, snapshotting amounts, with an event per invoice', async () => {
    const store = billingStore(db);
    const first = await aBillableHome();
    const second = await aBillableHome();
    const correlationId = 'billing-run-1';
    const seenIds: number[] = [];

    const invoices = await store.raiseInvoices(
      { period: '2026-09', dueOn: onDay('2026-10-05'), raisedById: first.committee.id, raisedAt: onDay('2026-09-01') },
      [
        { unitId: first.unit.id, amountPaise: C.rupees(3500) },
        { unitId: second.unit.id, amountPaise: C.rupees(3500) },
      ],
      (invoice) => {
        // The callback sees the row with its id, because the mail names the invoice.
        seenIds.push(invoice.id);
        return [
          { type: 'invoice.raised', channel: 'EMAIL', payload: { invoiceId: invoice.id }, correlationId },
        ];
      },
    );

    expect(invoices).not.toBeNull();
    expect(invoices).toHaveLength(2);
    expect(seenIds).toHaveLength(2);
    for (const invoice of invoices ?? []) {
      expect(invoice.amountPaise).toBe(C.rupees(3500));
      expect(invoice.status).toBe('UNPAID');
      expect(invoice.payment).toBeNull();
      expect(seenIds).toContain(invoice.id);
    }
    expect(await db.invoice.count({ where: { period: '2026-09' } })).toBe(2);
    expect(await db.outboxEvent.count({ where: { correlationId } })).toBe(2);

    // The snapshot, not the charge: raise, then change the unit's charge — the invoice stands.
    await db.unit.update({ where: { id: first.unit.id }, data: { monthlyChargePaise: C.rupees(9000) } });
    const reread = await store.findInvoiceById(invoices?.[0]?.id ?? -1);
    expect(reread?.amountPaise).toBe(C.rupees(3500));

    // And the household's list carries the join.
    const forUnit = await store.findInvoicesForUnit(first.unit.id);
    expect(forUnit.map((invoice) => invoice.period)).toEqual(['2026-09']);
  });

  it('refuses a run where a listed unit already has the period — whole, not in part', async () => {
    const store = billingStore(db);
    const home = await aBillableHome();
    const other = await aBillableHome();

    const first = await store.raiseInvoices(
      { period: '2026-10', dueOn: onDay('2026-11-05'), raisedById: home.committee.id, raisedAt: onDay('2026-10-01') },
      [{ unitId: home.unit.id, amountPaise: C.rupees(3500) }],
      () => [anEvent('invoice.raised')],
    );
    expect(first).toHaveLength(1);

    // The second run lists the unit that already has this period AND one that does not — it
    // must refuse everything rather than raise the missing one and report a partial count
    // (D-17: the guarantee is per run, not per unit).
    const event = anEvent('invoice.raised');
    const second = await store.raiseInvoices(
      { period: '2026-10', dueOn: onDay('2026-11-05'), raisedById: home.committee.id, raisedAt: onDay('2026-10-02') },
      [
        { unitId: other.unit.id, amountPaise: C.rupees(3500) },
        { unitId: home.unit.id, amountPaise: C.rupees(3500) },
      ],
      () => [event],
    );
    expect(second).toBeNull();
    expect(await db.invoice.count({ where: { period: '2026-10' } })).toBe(1);
    expect(await db.invoice.count({ where: { period: '2026-10', unitId: other.unit.id } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);
  });

  it('counts a period for the friendly pre-check', async () => {
    const store = billingStore(db);
    expect(await store.countInvoicesForPeriod('2026-09')).toBe(2);
    expect(await store.countInvoicesForPeriod('2099-01')).toBe(0);
  });
});

describe('recordPayment', () => {
  it('settles an invoice and allocates the period receipt numbers in sequence', async () => {
    const store = billingStore(db);
    const first = await aBillableHome();
    const second = await aBillableHome();
    const invoices =
      (await store.raiseInvoices(
        { period: '2026-11', dueOn: onDay('2026-12-05'), raisedById: first.committee.id, raisedAt: onDay('2026-11-01') },
        [
          { unitId: first.unit.id, amountPaise: C.rupees(3500) },
          { unitId: second.unit.id, amountPaise: C.rupees(3500) },
        ],
        () => [],
      )) ?? [];
    expect(invoices).toHaveLength(2);

    const event = anEvent('payment.received');
    const payment = await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'UPI',
        paidAt: onDay('2026-11-20'),
        reference: 'PAYTESTREF0001',
      },
      (made) => [{ ...event, payload: { receiptNo: made.receiptNo } }],
    );
    expect(payment?.receiptNo).toBe('REC-2026-11-00001');
    expect(payment?.method).toBe('UPI');

    // The invoice's own read now joins the settlement its status claims (D-26).
    const settled = await store.findInvoiceById(invoices[0]!.id);
    expect(settled?.status).toBe('PAID');
    expect(settled?.payment?.receiptNo).toBe('REC-2026-11-00001');
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    // The second payment in the same period takes the next number (D-37).
    const next = await store.recordPayment(
      {
        invoiceId: invoices[1]!.id,
        recordedById: second.committee.id,
        amountPaise: C.rupees(3500),
        method: 'CASH',
        paidAt: onDay('2026-11-21'),
        reference: 'PAYTESTREF0002',
      },
      () => [],
    );
    expect(next?.receiptNo).toBe('REC-2026-11-00002');
    expect(next?.recordedById).toBe(second.committee.id);
  });

  it('a replayed reference returns the existing payment and writes nothing', async () => {
    const store = billingStore(db);
    const home = await aBillableHome();
    const invoices =
      (await store.raiseInvoices(
        { period: '2026-12', dueOn: onDay('2027-01-05'), raisedById: home.committee.id, raisedAt: onDay('2026-12-01') },
        [{ unitId: home.unit.id, amountPaise: C.rupees(3500) }],
        () => [],
      )) ?? [];
    const first = await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'CARD',
        paidAt: onDay('2026-12-20'),
        reference: 'PAYTESTREPLAY1',
      },
      () => [],
    );
    expect(first).not.toBeNull();

    // The same confirmation again: the same row, unchanged, and nothing written.
    const event = anEvent('payment.received');
    const replay = await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'CARD',
        paidAt: onDay('2026-12-20'),
        reference: 'PAYTESTREPLAY1',
      },
      () => [event],
    );
    expect(replay?.id).toBe(first?.id);
    expect(replay?.receiptNo).toBe(first?.receiptNo);
    expect(await db.payment.count({ where: { reference: 'PAYTESTREPLAY1' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(0);

    // A settled invoice with a fresh reference is a null, not a second settlement.
    const refused = await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'UPI',
        paidAt: onDay('2026-12-21'),
        reference: 'PAYTESTFRESH99',
      },
      () => [],
    );
    expect(refused).toBeNull();
    expect(await store.findInvoiceById(invoices[0]!.id + 1_000_000)).toBeNull();
  });
});

describe('cancelInvoice', () => {
  it('cancels a payable invoice with its reason; the second attempt is a null', async () => {
    const store = billingStore(db);
    const home = await aBillableHome();
    const invoices =
      (await store.raiseInvoices(
        { period: '2027-01', dueOn: onDay('2027-02-05'), raisedById: home.committee.id, raisedAt: onDay('2027-01-01') },
        [{ unitId: home.unit.id, amountPaise: C.rupees(3500) }],
        () => [],
      )) ?? [];
    const event = anEvent('invoice.raised');

    const cancelled = await store.cancelInvoice(
      { invoiceId: invoices[0]!.id, reason: 'Raised for the wrong period', cancelledAt: onDay('2027-01-02') },
      [event],
    );
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.cancelledReason).toBe('Raised for the wrong period');
    expect(await db.outboxEvent.count({ where: { correlationId: event.correlationId } })).toBe(1);

    const second = await store.cancelInvoice(
      { invoiceId: invoices[0]!.id, reason: 'Again', cancelledAt: onDay('2027-01-03') },
      [anEvent('invoice.raised')],
    );
    expect(second).toBeNull();
  });

  it('a settled invoice cannot be cancelled', async () => {
    const store = billingStore(db);
    const home = await aBillableHome();
    const invoices =
      (await store.raiseInvoices(
        { period: '2027-02', dueOn: onDay('2027-03-05'), raisedById: home.committee.id, raisedAt: onDay('2027-02-01') },
        [{ unitId: home.unit.id, amountPaise: C.rupees(3500) }],
        () => [],
      )) ?? [];
    await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'NETBANKING',
        paidAt: onDay('2027-02-20'),
        reference: 'PAYTESTCANCEL1',
      },
      () => [],
    );

    const cancelled = await store.cancelInvoice(
      { invoiceId: invoices[0]!.id, reason: 'Too late', cancelledAt: onDay('2027-02-21') },
      [],
    );
    expect(cancelled).toBeNull();
    expect((await store.findInvoiceById(invoices[0]!.id))?.status).toBe('PAID');
  });
});

describe('markInvoicesOverdue', () => {
  it('flags unpaid invoices due strictly before the cutoff, and only those', async () => {
    const store = billingStore(db);
    const homes = [await aBillableHome(), await aBillableHome(), await aBillableHome()];
    const committee = homes[0]!.committee;
    const units = homes.map((home) => home.unit);
    const invoices =
      (await store.raiseInvoices(
        {
          period: '2027-03',
          dueOn: onDay('2027-03-05'),
          raisedById: committee.id,
          raisedAt: onDay('2027-03-01'),
        },
        units.map((unit) => ({ unitId: unit.id, amountPaise: C.rupees(3500) })),
        () => [],
      )) ?? [];
    expect(invoices).toHaveLength(3);

    // One was settled before the cutoff, one is not due yet, one is due before it.
    await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'UPI',
        paidAt: onDay('2027-03-02'),
        reference: 'PAYTESTOVERDUE1',
      },
      () => [],
    );
    await db.invoice.update({
      where: { id: invoices[1]!.id },
      data: { dueOn: onDay('2027-04-05') },
    });

    // The caller's "today" began 2027-03-06: strictly before it is overdue (D-36). The scan sees
    // the whole ledger, so the assertions are about these three invoices, not the entire result.
    const seen: number[] = [];
    const result = await store.markInvoicesOverdue(
      { dueBefore: onDay('2027-03-06') },
      (invoice) => {
        seen.push(invoice.id);
        return Promise.resolve([anEvent('invoice.overdue')]);
      },
    );

    const flaggedIds = result.map((invoice) => invoice.id);
    expect(flaggedIds).toContain(invoices[2]!.id);
    expect(flaggedIds).not.toContain(invoices[0]!.id);
    expect(flaggedIds).not.toContain(invoices[1]!.id);
    expect(result.find((invoice) => invoice.id === invoices[2]!.id)?.status).toBe('OVERDUE');
    // The paid one and the not-yet-due one were never candidates, so they were never mailed about.
    expect(seen).toContain(invoices[2]!.id);
    expect(seen).not.toContain(invoices[0]!.id);
    expect(seen).not.toContain(invoices[1]!.id);
    expect((await store.findInvoiceById(invoices[0]!.id))?.status).toBe('PAID');
    expect((await store.findInvoiceById(invoices[1]!.id))?.status).toBe('UNPAID');
    expect((await store.findInvoiceById(invoices[2]!.id))?.status).toBe('OVERDUE');

    // A second run does not re-flag the same row — it is no longer UNPAID.
    const again = await store.markInvoicesOverdue(
      { dueBefore: onDay('2027-03-06') },
      () => Promise.resolve([]),
    );
    expect(again.some((invoice) => invoice.id === invoices[2]!.id)).toBe(false);
  });
});

describe('findReceiptByNo', () => {
  it('joins the payment, invoice, home and the household name', async () => {
    const store = billingStore(db);
    const home = await aBillableHome();
    const invoices =
      (await store.raiseInvoices(
        { period: '2027-04', dueOn: onDay('2027-05-05'), raisedById: home.committee.id, raisedAt: onDay('2027-04-01') },
        [{ unitId: home.unit.id, amountPaise: C.rupees(3500) }],
        () => [],
      )) ?? [];
    const payment = await store.recordPayment(
      {
        invoiceId: invoices[0]!.id,
        recordedById: null,
        amountPaise: C.rupees(3500),
        method: 'UPI',
        paidAt: onDay('2027-04-20'),
        reference: 'PAYTESTRECEIPT1',
      },
      () => [],
    );
    expect(payment).not.toBeNull();

    const receipt = await store.findReceiptByNo(payment?.receiptNo ?? 'REC-NOPE');
    expect(receipt?.payment.id).toBe(payment?.id);
    expect(receipt?.invoice.id).toBe(invoices[0]!.id);
    expect(receipt?.invoice.status).toBe('PAID');
    expect(receipt?.home.unitId).toBe(home.unit.id);
    // The household names itself: the unit's first-listed ACTIVE resident (D-26).
    expect(receipt?.payerName).toBe(home.resident.name);
    expect(await store.findReceiptByNo('REC-2027-04-99999')).toBeNull();
  });
});
