import { describe, expect, it } from 'vitest';
import * as C from '@oneresi/contracts';
import { billingService } from './billing.js';
import type { Clock } from './clock.js';
import type {
  BillingStore,
  OutboxEventInput,
  StoredHome,
  StoredInvoice,
  StoredPayment,
  StoredReceipt,
} from './store.js';
import type { Actor, BillingService, InvoiceView, ReceiptView, Result, SystemActor } from './ports.js';

/**
 * The billing service, exercised against an in-memory store. The register's complaints each
 * have a test here: a cycle is all-or-nothing (D-17), the amount is the census's snapshot
 * (D-50), payment is scoped to the household (D-07), receipt numbers come from the per-period
 * sequence (D-37), the receipt is the persisted row (D-26), and overdue is "strictly before
 * today, in the society's timezone" (D-36).
 */

// ---------------------------------------------------------------- fakes

class MutableClock implements Clock {
  #now: Date;
  constructor(iso: string) {
    this.#now = new Date(iso);
  }
  now(): Date {
    return this.#now;
  }
  setNow(iso: string): void {
    this.#now = new Date(iso);
  }
}

interface UnitRow {
  unitId: number;
  blockName: string;
  label: string;
  chargePaise: C.Paise;
  active: boolean;
}

interface ResidentRow {
  id: number;
  unitId: number;
  name: string;
  email: string;
  active: boolean;
}

/** The store's own mutable row; snapshots handed back are the read-only StoredInvoice. */
interface InvoiceRow {
  id: number;
  unitId: number;
  raisedById: number;
  period: string;
  amountPaise: C.Paise;
  dueOn: Date;
  status: C.InvoiceStatus;
  cancelledReason: string | null;
  payment: StoredPayment | null;
}

/** An in-memory BillingStore: the same contract the db package will implement, minus SQL. */
class MemoryBillingStore implements BillingStore {
  private nextUnitId = 1;
  private nextResidentId = 1;
  private nextInvoiceId = 1;
  private nextPaymentId = 1;
  readonly units: UnitRow[] = [];
  readonly residents: ResidentRow[] = [];
  readonly invoices: InvoiceRow[] = [];
  /** Payments by their unique reference — the replay guard. */
  readonly paymentsByReference = new Map<string, StoredPayment>();
  /** The per-period sequence the receipt number is drawn from (D-37). */
  readonly receiptSequences = new Map<string, number>();
  readonly outbox: OutboxEventInput[] = [];
  /** Test hooks: simulate the guarded writes losing a race. */
  forceNextRaiseNull = false;
  forceNextPayNull = false;
  forceNextCancelNull = false;
  /** When set, the next recordPayment returns an existing payment for ANOTHER invoice. */
  crossInvoiceReference = false;

  // ---- seeding, test-only

  seedUnit(blockName: string, label: string, chargePaise: number, active = true): number {
    const unitId = this.nextUnitId++;
    this.units.push({ unitId, blockName, label, chargePaise: C.paise(chargePaise), active });
    return unitId;
  }

  seedResident(unitId: number, name: string, email: string, active = true): number {
    const id = this.nextResidentId++;
    this.residents.push({ id, unitId, name, email, active });
    return id;
  }

  seedInvoice(row: {
    unitId: number;
    period: string;
    amountPaise: number;
    dueOn: string;
    status?: C.InvoiceStatus;
  }): InvoiceRow {
    const invoice: InvoiceRow = {
      id: this.nextInvoiceId++,
      unitId: row.unitId,
      raisedById: 902,
      period: row.period,
      amountPaise: C.paise(row.amountPaise),
      dueOn: new Date(`${row.dueOn}T00:00:00.000Z`),
      status: row.status ?? 'UNPAID',
      cancelledReason: null,
      payment: null,
    };
    this.invoices.push(invoice);
    return invoice;
  }

  // ---- lookups

  private homeFor(unitId: number): StoredHome | null {
    const unit = this.units.find((u) => u.unitId === unitId);
    if (unit === undefined) return null;
    return {
      unitId,
      blockId: 1,
      blockName: unit.blockName,
      label: unit.label,
      type: 'FLAT_2BHK',
      monthlyChargePaise: unit.chargePaise,
      active: unit.active,
    };
  }

  findHome(unitId: number): Promise<StoredHome | null> {
    return Promise.resolve(this.homeFor(unitId));
  }

  findResidentsForUnit(
    unitId: number,
  ): Promise<readonly { id: number; name: string; email: string }[]> {
    return Promise.resolve(
      this.residents.filter((r) => r.unitId === unitId && r.active).map((r) => ({ id: r.id, name: r.name, email: r.email })),
    );
  }

  billableUnits(): Promise<
    readonly { unitId: number; blockName: string; label: string; monthlyChargePaise: C.Paise }[]
  > {
    return Promise.resolve(
      this.units
        .filter((u) => u.active && u.chargePaise > 0)
        .map((u) => ({
          unitId: u.unitId,
          blockName: u.blockName,
          label: u.label,
          monthlyChargePaise: u.chargePaise,
        })),
    );
  }

  countInvoicesForPeriod(period: string): Promise<number> {
    return Promise.resolve(this.invoices.filter((i) => i.period === period).length);
  }

  private snapshotInvoice(invoice: InvoiceRow): StoredInvoice {
    return { ...invoice, payment: invoice.payment === null ? null : { ...invoice.payment } };
  }

  findInvoiceById(id: number): Promise<StoredInvoice | null> {
    const invoice = this.invoices.find((i) => i.id === id);
    return Promise.resolve(invoice === undefined ? null : this.snapshotInvoice(invoice));
  }

  findInvoicesForUnit(unitId: number): Promise<readonly StoredInvoice[]> {
    return Promise.resolve(
      this.invoices.filter((i) => i.unitId === unitId).map((i) => this.snapshotInvoice(i)),
    );
  }

  findInvoicesForSociety(): Promise<readonly (StoredInvoice & { home: StoredHome })[]> {
    // Newest period first, like the household list — and like the adapter, the home is a join:
    // an invoice whose unit is unknown to the fake has no home line to show, so it is not listed.
    const ordered = [...this.invoices].sort(
      (a, b) => b.period.localeCompare(a.period) || a.id - b.id,
    );
    return Promise.resolve(
      ordered.flatMap((invoice) => {
        const home = this.homeFor(invoice.unitId);
        return home === null ? [] : [{ ...this.snapshotInvoice(invoice), home }];
      }),
    );
  }

  // ---- writes (each one is "a transaction" in the real store)

  raiseInvoices(
    input: { period: string; dueOn: Date; raisedById: number; raisedAt: Date },
    units: readonly { unitId: number; amountPaise: C.Paise }[],
    eventsFor: (invoice: StoredInvoice) => readonly OutboxEventInput[],
  ): Promise<readonly StoredInvoice[] | null> {
    if (this.forceNextRaiseNull) {
      this.forceNextRaiseNull = false;
      return Promise.resolve(null);
    }
    // The (unitId, period) unique constraint: refuse the whole run, not a part of it (D-17).
    if (units.some((u) => this.invoices.some((i) => i.unitId === u.unitId && i.period === input.period))) {
      return Promise.resolve(null);
    }
    const raised: StoredInvoice[] = [];
    for (const unit of units) {
      const invoice: InvoiceRow = {
        id: this.nextInvoiceId++,
        unitId: unit.unitId,
        raisedById: input.raisedById,
        period: input.period,
        amountPaise: unit.amountPaise,
        dueOn: input.dueOn,
        status: 'UNPAID',
        cancelledReason: null,
        payment: null,
      };
      this.invoices.push(invoice);
      const snapshot = this.snapshotInvoice(invoice);
      raised.push(snapshot);
      this.outbox.push(...eventsFor(snapshot));
    }
    return Promise.resolve(raised);
  }

  recordPayment(
    input: {
      invoiceId: number;
      recordedById: number | null;
      amountPaise: C.Paise;
      method: C.PaymentMethod;
      paidAt: Date;
      reference: string;
    },
    eventsFor: (payment: StoredPayment) => readonly OutboxEventInput[],
  ): Promise<StoredPayment | null> {
    // One row per intent: a repeated confirmation replays the first, it does not duplicate it.
    const existing = this.paymentsByReference.get(input.reference);
    if (existing !== undefined) {
      if (this.crossInvoiceReference) {
        this.crossInvoiceReference = false;
        return Promise.resolve(existing);
      }
      return Promise.resolve({ ...existing });
    }
    if (this.forceNextPayNull) {
      this.forceNextPayNull = false;
      return Promise.resolve(null);
    }
    const invoice = this.invoices.find((i) => i.id === input.invoiceId);
    if (invoice === undefined || (invoice.status !== 'UNPAID' && invoice.status !== 'OVERDUE')) {
      return Promise.resolve(null);
    }
    const sequence = this.receiptSequences.get(invoice.period) ?? 1;
    this.receiptSequences.set(invoice.period, sequence + 1);
    const payment: StoredPayment = {
      id: this.nextPaymentId++,
      invoiceId: invoice.id,
      recordedById: input.recordedById,
      amountPaise: input.amountPaise,
      method: input.method,
      receiptNo: C.receiptNumber(invoice.period, sequence),
      reference: input.reference,
      paidAt: input.paidAt,
    };
    this.paymentsByReference.set(payment.reference, payment);
    invoice.payment = payment;
    invoice.status = 'PAID';
    this.outbox.push(...eventsFor(payment));
    return Promise.resolve({ ...payment });
  }

  cancelInvoice(
    input: { invoiceId: number; reason: string; cancelledAt: Date },
    _events: readonly OutboxEventInput[],
  ): Promise<StoredInvoice | null> {
    if (this.forceNextCancelNull) {
      this.forceNextCancelNull = false;
      return Promise.resolve(null);
    }
    const invoice = this.invoices.find((i) => i.id === input.invoiceId);
    if (invoice === undefined || (invoice.status !== 'UNPAID' && invoice.status !== 'OVERDUE')) {
      return Promise.resolve(null);
    }
    invoice.status = 'CANCELLED';
    invoice.cancelledReason = input.reason;
    return Promise.resolve(this.snapshotInvoice(invoice));
  }

  async markInvoicesOverdue(
    input: { dueBefore: Date },
    eventsFor: (invoice: StoredInvoice) => Promise<readonly OutboxEventInput[]>,
  ): Promise<readonly StoredInvoice[]> {
    const flagged: StoredInvoice[] = [];
    for (const invoice of this.invoices) {
      if (invoice.status !== 'UNPAID' || !(invoice.dueOn.getTime() < input.dueBefore.getTime())) {
        continue;
      }
      invoice.status = 'OVERDUE';
      const snapshot = this.snapshotInvoice(invoice);
      flagged.push(snapshot);
      this.outbox.push(...(await eventsFor(snapshot)));
    }
    return flagged;
  }

  findReceiptByNo(receiptNo: string): Promise<StoredReceipt | null> {
    const invoice = this.invoices.find((i) => i.payment?.receiptNo === receiptNo);
    if (invoice === undefined || invoice.payment === null) return Promise.resolve(null);
    const home = this.homeFor(invoice.unitId);
    if (home === null) return Promise.resolve(null);
    // The model keeps no payer column; the household names itself — first-listed ACTIVE resident.
    const payer = this.residents.find((r) => r.unitId === invoice.unitId && r.active);
    return Promise.resolve({
      payment: { ...invoice.payment },
      invoice: this.snapshotInvoice(invoice),
      home,
      payerName: payer === undefined ? '' : payer.name,
    });
  }
}

// ---------------------------------------------------------------- harness

interface Harness {
  service: BillingService;
  store: MemoryBillingStore;
  clock: MutableClock;
}

function harness(): Harness {
  const clock = new MutableClock('2026-09-08T09:00:00Z');
  const store = new MemoryBillingStore();
  const service = billingService({ store, clock });
  return { service, store, clock };
}

const ADMIN: Actor = {
  userId: 902,
  name: 'Committee Chair',
  role: 'A',
  unitId: null,
  email: 'chair@oneresi.in',
};

const SYSTEM: SystemActor = { role: 'SYSTEM', reason: 'scheduled overdue run' };

function residentActor(store: MemoryBillingStore, unitId: number): Actor {
  const resident = store.residents.find((r) => r.unitId === unitId);
  if (resident === undefined) throw new Error(`no resident for unit ${unitId}`);
  return { userId: resident.id, name: resident.name, role: 'R', unitId, email: resident.email };
}

/** Two charged units with residents, one zero-charge unit, one retired unit — a whole society. */
function seededWorld(store: MemoryBillingStore): {
  unitId: number;
  otherUnitId: number;
  zeroUnitId: number;
  retiredUnitId: number;
} {
  const unitId = store.seedUnit('Brindavan', 'B-101', 250_000);
  const otherUnitId = store.seedUnit('Brindavan', 'B-102', 180_000);
  const zeroUnitId = store.seedUnit('Brindavan', 'B-103', 0);
  const retiredUnitId = store.seedUnit('Brindavan', 'B-104', 250_000, false);
  store.seedResident(unitId, 'Asha Rao', 'asha@example.com');
  store.seedResident(unitId, 'Vikram Rao', 'vikram@example.com');
  store.seedResident(otherUnitId, 'Priya Sharma', 'priya@example.com');
  store.seedResident(zeroUnitId, 'Zero Charge', 'zero@example.com');
  store.seedResident(retiredUnitId, 'Retired Unit', 'retired@example.com');
  return { unitId, otherUnitId, zeroUnitId, retiredUnitId };
}

const expectError = async <T>(
  result: Promise<Result<T>>,
  code: string,
): Promise<{ code: string; message: string; field?: string }> => {
  const settled = await result;
  if (settled.ok) throw new Error('expected a failure, got a value');
  expect(settled.error.code).toBe(code);
  return settled.error;
};

async function expectOk<T>(result: Promise<Result<T>>): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw new Error(`expected a value, got ${settled.error.code}`);
  return settled.value;
}

// ---------------------------------------------------------------- tests

describe('raiseForPeriod', () => {
  it('raises one invoice per charged active unit, snapshotted, and mails each household (D-29, D-50)', async () => {
    const world = harness();
    seededWorld(world.store);

    const { raised } = await expectOk(
      world.service.raiseForPeriod(ADMIN, C.RaiseInvoicesInput.parse({ period: '2026-09', dueDate: '2026-09-20' })),
    );

    // B-101 and B-102 bill; the zero-charge unit and the retired unit do not.
    expect(raised).toBe(2);
    const invoices = world.store.invoices;
    expect(invoices.map((i) => i.unitId).sort()).toEqual([1, 2]);
    expect(invoices.every((i) => i.status === 'UNPAID')).toBe(true);
    expect(invoices.every((i) => i.amountPaise === (i.unitId === 1 ? C.paise(250_000) : C.paise(180_000)))).toBe(true);
    expect(invoices.every((i) => i.dueOn)).toEqual(true);
    expect(new Set(invoices.map((i) => i.period))).toEqual(new Set(['2026-09']));

    // One email per ACTIVE resident of each billed home: two on B-101, one on B-102.
    expect(world.store.outbox).toHaveLength(3);
    expect(world.store.outbox.every((e) => e.type === 'invoice.raised' && e.channel === 'EMAIL')).toBe(true);
    const asha = world.store.outbox.find((e) => e.payload['email'] === 'asha@example.com');
    expect(asha?.payload).toEqual(
      expect.objectContaining({
        recipientName: 'Asha Rao',
        home: 'Brindavan · B-101',
        period: '2026-09',
        amountPaise: 250_000,
        dueOn: '2026-09-20T00:00:00.000Z',
      }),
    );
    expect(asha?.payload['invoiceId']).toEqual(expect.any(Number));
  });

  it('refuses a period that has already been generated, and refuses it flat (D-17)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });

    const error = await expectError(
      world.service.raiseForPeriod(ADMIN, C.RaiseInvoicesInput.parse({ period: '2026-09', dueDate: '2026-09-20' })),
      'LIMIT_REACHED',
    );
    expect(error.message).toBe('That period has already been generated.');
    expect(world.store.outbox).toHaveLength(0);
  });

  it('reports a run that lost the race to the constraint the same way (D-17)', async () => {
    const world = harness();
    seededWorld(world.store);
    world.store.forceNextRaiseNull = true;

    await expectError(
      world.service.raiseForPeriod(ADMIN, C.RaiseInvoicesInput.parse({ period: '2026-09', dueDate: '2026-09-20' })),
      'LIMIT_REACHED',
    );
  });

  it('refuses a due date in the past, and a resident from running a cycle at all', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);

    const error = await expectError(
      world.service.raiseForPeriod(ADMIN, C.RaiseInvoicesInput.parse({ period: '2026-09', dueDate: '2026-09-07' })),
      'INVALID_INPUT',
    );
    expect(error.field).toBe('dueDate');

    await expectError(
      world.service.raiseForPeriod(residentActor(world.store, unitId), C.RaiseInvoicesInput.parse({ period: '2026-09', dueDate: '2026-09-20' })),
      'FORBIDDEN',
    );
  });

  it('raises nothing over an empty census, and calls that a success', async () => {
    const world = harness();

    const { raised } = await expectOk(
      world.service.raiseForPeriod(ADMIN, C.RaiseInvoicesInput.parse({ period: '2026-09', dueDate: '2026-09-20' })),
    );

    expect(raised).toBe(0);
    expect(world.store.outbox).toHaveLength(0);
  });
});

describe('pay', () => {
  it('settles the household invoice in full, with a sequenced receipt number and a mail per resident', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });

    const settled: InvoiceView = await expectOk(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: invoice.id })),
    );

    expect(settled.status).toBe('PAID');
    expect(settled.receiptNo).toBe('REC-2026-09-00001');
    expect(settled.paidAt).toEqual(new Date('2026-09-08T09:00:00Z'));
    expect(world.store.invoices.find((i) => i.id === invoice.id)?.status).toBe('PAID');

    // Two residents on B-101: two payment.received rows, one each (D-29).
    expect(world.store.outbox).toHaveLength(2);
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        recipientName: 'Asha Rao',
        home: 'Brindavan · B-101',
        period: '2026-09',
        receiptNo: 'REC-2026-09-00001',
        amountPaise: 250_000,
        method: 'UPI',
        paidAt: '2026-09-08T09:00:00.000Z',
      }),
    );
  });

  it('numbers receipts from the per-period sequence, so two payments never share one (D-37)', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const mine = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });
    const theirs = world.store.seedInvoice({ unitId: otherUnitId, period: '2026-09', amountPaise: 180_000, dueOn: '2026-09-20' });

    const first = await expectOk(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: mine.id })),
    );
    const second = await expectOk(
      world.service.pay(residentActor(world.store, otherUnitId), C.PayInvoiceInput.parse({ invoiceId: theirs.id })),
    );

    expect(first.receiptNo).toBe('REC-2026-09-00001');
    expect(second.receiptNo).toBe('REC-2026-09-00002');
  });

  it('treats another household\'s invoice as missing — anyone could settle any invoice before (D-07)', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const theirs = world.store.seedInvoice({ unitId: otherUnitId, period: '2026-09', amountPaise: 180_000, dueOn: '2026-09-20' });

    await expectError(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: theirs.id })),
      'NOT_FOUND',
    );
  });

  it('replays an idempotent confirmation: one payment row, the same receipt, no duplicate mail', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });
    const key = C.idempotencyKey();
    const actor = residentActor(world.store, unitId);

    const first = await expectOk(
      world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: invoice.id, idempotencyKey: key })),
    );
    const second = await expectOk(
      world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: invoice.id, idempotencyKey: key })),
    );

    expect(second.receiptNo).toBe(first.receiptNo);
    expect(world.store.paymentsByReference).toHaveLength(1);
    expect(world.store.outbox).toHaveLength(2);
  });

  it('refuses one intent reused across two invoices (D-37)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const september = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });
    const october = world.store.seedInvoice({ unitId, period: '2026-10', amountPaise: 250_000, dueOn: '2026-10-20' });
    const key = C.idempotencyKey();
    const actor = residentActor(world.store, unitId);

    await expectOk(world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: september.id, idempotencyKey: key })));
    world.store.crossInvoiceReference = true;
    const error = await expectError(
      world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: october.id, idempotencyKey: key })),
      'CONFLICT',
    );
    expect(error.message).toBe('That payment reference was already used.');
  });

  it('refuses a settled, a cancelled, and a racing settlement (D-26)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const paid = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-08-20', status: 'PAID' });
    const cancelled = world.store.seedInvoice({ unitId, period: '2026-07', amountPaise: 250_000, dueOn: '2026-07-20', status: 'CANCELLED' });
    const racing = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });
    const actor = residentActor(world.store, unitId);

    await expectError(world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: paid.id })), 'ALREADY_DONE');
    await expectError(world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: cancelled.id })), 'STATE_NOT_ALLOWED');
    world.store.forceNextPayNull = true;
    await expectError(world.service.pay(actor, C.PayInvoiceInput.parse({ invoiceId: racing.id })), 'CONFLICT');
  });

  it('settles an overdue invoice the same way — overdue is not a refusal', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const overdue = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-08-20', status: 'OVERDUE' });

    const settled = await expectOk(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: overdue.id })),
    );
    expect(settled.status).toBe('PAID');
  });
});

describe('recordOffline', () => {
  it('records cash the committee took, on the day it was taken, attributed to the member', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });

    const settled: InvoiceView = await expectOk(
      world.service.recordOffline(
        ADMIN,
        C.RecordOfflinePaymentInput.parse({
          invoiceId: invoice.id,
          amountPaise: 250_000,
          method: 'CASH',
          receivedOn: '2026-09-07',
        }),
      ),
    );

    expect(settled.status).toBe('PAID');
    const stored = [...world.store.paymentsByReference.values()][0];
    expect(stored).toMatchObject({
      recordedById: ADMIN.userId,
      method: 'CASH',
      amountPaise: C.paise(250_000),
      paidAt: new Date('2026-09-07T00:00:00.000Z'),
    });
  });

  it('refuses a partial amount, a future date, and anyone but the committee', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });

    const partial = await expectError(
      world.service.recordOffline(
        ADMIN,
        C.RecordOfflinePaymentInput.parse({ invoiceId: invoice.id, amountPaise: 100_000, method: 'CASH', receivedOn: '2026-09-07' }),
      ),
      'INVALID_INPUT',
    );
    expect(partial.field).toBe('amountPaise');
    expect(partial.message).toContain('in full');

    const future = await expectError(
      world.service.recordOffline(
        ADMIN,
        C.RecordOfflinePaymentInput.parse({ invoiceId: invoice.id, amountPaise: 250_000, method: 'CASH', receivedOn: '2026-09-09' }),
      ),
      'INVALID_INPUT',
    );
    expect(future.field).toBe('receivedOn');

    await expectError(
      world.service.recordOffline(
        residentActor(world.store, unitId),
        C.RecordOfflinePaymentInput.parse({ invoiceId: invoice.id, amountPaise: 250_000, method: 'CASH', receivedOn: '2026-09-07' }),
      ),
      'FORBIDDEN',
    );
  });
});

describe('cancel', () => {
  it('voids an unpaid invoice with its reason, and only the committee can', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });

    const cancelled = await expectOk(
      world.service.cancel(ADMIN, C.CancelInvoiceInput.parse({ invoiceId: invoice.id, reason: 'Raised twice by mistake' })),
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(world.store.invoices.find((i) => i.id === invoice.id)?.cancelledReason).toBe('Raised twice by mistake');

    await expectError(
      world.service.cancel(residentActor(world.store, unitId), C.CancelInvoiceInput.parse({ invoiceId: invoice.id, reason: 'Not mine to void' })),
      'FORBIDDEN',
    );
  });

  it('refuses a settled invoice, calls a repeated cancellation done, and reports a lost race', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const paid = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-08-20', status: 'PAID' });
    const cancelled = world.store.seedInvoice({ unitId, period: '2026-07', amountPaise: 250_000, dueOn: '2026-07-20', status: 'CANCELLED' });
    const racing = world.store.seedInvoice({ unitId, period: '2026-06', amountPaise: 250_000, dueOn: '2026-06-20' });

    await expectError(
      world.service.cancel(ADMIN, C.CancelInvoiceInput.parse({ invoiceId: paid.id, reason: 'Already settled' })),
      'STATE_NOT_ALLOWED',
    );
    await expectError(
      world.service.cancel(ADMIN, C.CancelInvoiceInput.parse({ invoiceId: cancelled.id, reason: 'Again' })),
      'ALREADY_DONE',
    );
    world.store.forceNextCancelNull = true;
    await expectError(
      world.service.cancel(ADMIN, C.CancelInvoiceInput.parse({ invoiceId: racing.id, reason: 'Race' })),
      'CONFLICT',
    );
  });
});

describe('receipt', () => {
  it('renders the household\'s receipt from the persisted payment row (D-26)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 480_000, dueOn: '2026-09-20' });
    const settled = await expectOk(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: invoice.id })),
    );
    const reference = [...world.store.paymentsByReference.values()][0]?.reference;

    const receipt: ReceiptView = await expectOk(
      world.service.receipt(residentActor(world.store, unitId), settled.receiptNo ?? ''),
    );

    expect(receipt).toMatchObject({
      receiptNo: 'REC-2026-09-00001',
      paidAt: new Date('2026-09-08T09:00:00Z'),
      method: 'UPI',
      amountPaise: C.paise(480_000),
      amountInWords: 'Four thousand eight hundred rupees only',
      period: '2026-09',
      payerName: 'Asha Rao',
      reference,
    });
    expect(receipt.home).toMatchObject({ blockName: 'Brindavan', label: 'B-101' });
  });

  it('lets the committee read any receipt, and hides another household\'s as missing', async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });
    const settled = await expectOk(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: invoice.id })),
    );
    const receiptNo = settled.receiptNo ?? '';

    await expectOk(world.service.receipt(ADMIN, receiptNo));
    await expectError(world.service.receipt(residentActor(world.store, otherUnitId), receiptNo), 'NOT_FOUND');
    await expectError(world.service.receipt(residentActor(world.store, unitId), 'REC-2020-01-99999'), 'NOT_FOUND');
  });
});

describe('flagOverdue', () => {
  it('flags invoices due strictly before today — an invoice due today is not overdue at 00:01 (D-36)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const past = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-09-07' });
    const today = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-09-08' });
    const future = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });

    const { flagged } = await expectOk(world.service.flagOverdue(SYSTEM, world.clock.now()));

    expect(flagged).toBe(1);
    expect(world.store.invoices.find((i) => i.id === past.id)?.status).toBe('OVERDUE');
    expect(world.store.invoices.find((i) => i.id === today.id)?.status).toBe('UNPAID');
    expect(world.store.invoices.find((i) => i.id === future.id)?.status).toBe('UNPAID');
  });

  it('rolls over at the society\'s midnight, not UTC\'s (D-36)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    const dueYesterdayIst = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-09-07' });

    // 18:30 UTC on the 8th is midnight IST on the 9th: the 8th is now yesterday.
    world.clock.setNow('2026-09-08T18:30:00Z');
    const { flagged } = await expectOk(world.service.flagOverdue(SYSTEM, world.clock.now()));

    expect(flagged).toBe(1);
    expect(world.store.invoices.find((i) => i.id === dueYesterdayIst.id)?.status).toBe('OVERDUE');

    // Half an hour earlier it was still the 8th in the society, and the invoice was on time.
    const earlier = harness();
    const unit = earlier.store.seedUnit('Brindavan', 'B-101', 250_000);
    earlier.store.seedResident(unit, 'Asha Rao', 'asha@example.com');
    earlier.store.seedInvoice({ unitId: unit, period: '2026-08', amountPaise: 250_000, dueOn: '2026-09-08' });
    earlier.clock.setNow('2026-09-08T18:29:00Z');
    const notYet = await expectOk(earlier.service.flagOverdue(SYSTEM, earlier.clock.now()));
    expect(notYet.flagged).toBe(0);
  });

  it('does not re-flag an overdue or settled invoice, and mails each household with the day count (D-29)', async () => {
    const world = harness();
    const { unitId } = seededWorld(world.store);
    world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-09-07', status: 'OVERDUE' });
    const paid = world.store.seedInvoice({ unitId, period: '2026-08', amountPaise: 250_000, dueOn: '2026-09-06', status: 'PAID' });
    void paid;
    const late = world.store.seedInvoice({ unitId, period: '2026-07', amountPaise: 250_000, dueOn: '2026-09-01' });

    const { flagged } = await expectOk(world.service.flagOverdue(SYSTEM, world.clock.now()));

    expect(flagged).toBe(1);
    expect(world.store.invoices.find((i) => i.id === late.id)?.status).toBe('OVERDUE');
    expect(world.store.outbox).toHaveLength(2);
    expect(world.store.outbox[0]?.type).toBe('invoice.overdue');
    expect(world.store.outbox[0]?.payload).toEqual(
      expect.objectContaining({
        recipientName: 'Asha Rao',
        home: 'Brindavan · B-101',
        period: '2026-07',
        daysOverdue: 7,
      }),
    );
  });
});

describe('forSociety', () => {
  it("is the committee's ledger: every invoice with its home, newest period first", async () => {
    const world = harness();
    const { unitId, otherUnitId } = seededWorld(world.store);
    const invoice = world.store.seedInvoice({ unitId, period: '2026-09', amountPaise: 250_000, dueOn: '2026-09-20' });
    world.store.seedInvoice({ unitId: otherUnitId, period: '2026-09', amountPaise: 180_000, dueOn: '2026-09-20' });
    world.store.seedInvoice({ unitId, period: '2026-10', amountPaise: 250_000, dueOn: '2026-10-20' });

    // One household settles its September bill — the ledger's join must say so (D-26).
    await expectOk(
      world.service.pay(residentActor(world.store, unitId), C.PayInvoiceInput.parse({ invoiceId: invoice.id })),
    );

    const ledger = await expectOk(world.service.forSociety(ADMIN));
    expect(ledger.map((entry) => entry.period)).toEqual(['2026-10', '2026-09', '2026-09']);

    const settled = ledger.find((entry) => entry.id === invoice.id);
    expect(settled?.status).toBe('PAID');
    expect(settled?.receiptNo).toBe('REC-2026-09-00001');
    expect(settled?.home).toMatchObject({ unitId, blockName: 'Brindavan', label: 'B-101' });

    const open = ledger.find((entry) => entry.period === '2026-09' && entry.home.unitId === otherUnitId);
    expect(open?.status).toBe('UNPAID');
    expect(open?.receiptNo).toBeNull();
    expect(open?.home.label).toBe('B-102');

    // A resident sees their own list, not the society's (D-42).
    await expectError(world.service.forSociety(residentActor(world.store, unitId)), 'FORBIDDEN');
  });
});
