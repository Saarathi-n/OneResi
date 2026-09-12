import { describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
import { reportsService } from './reports.js';
import type { Clock } from './clock.js';
import type {
  BillingStore,
  ComplaintStore,
  FacilitiesStore,
  StoredBooking,
  StoredComplaint,
  StoredHome,
  StoredInvoice,
  StoredPayment,
  StoredVisitorEntry,
  VisitorStore,
} from './store.js';
import type { Actor, ReportsService } from './ports.js';

/**
 * The reports service, exercised against in-memory stores with a handful of hand-authored rows.
 * What each test proves, per UC-27 and UC-26: the CSV carries the right cells for each kind, a
 * range is end-inclusive, an inverted range is refused with a readable message, an empty range
 * is a header-only file rather than an error, quoting is the route's job (cells here are bare),
 * only the committee may export or read the figures, and the dashboard's aggregates count
 * exactly what their names claim.
 */

class MutableClock implements Clock {
  #now: Date;
  constructor(iso: string) {
    this.#now = new Date(iso);
  }
  now(): Date {
    return this.#now;
  }
}

const HOME: StoredHome = {
  unitId: 1,
  blockId: 1,
  blockName: 'Gulmohar Court',
  label: 'A-101',
  type: 'FLAT_2BHK',
  monthlyChargePaise: C.paise(3_500),
  active: true,
};

interface InvoiceRow extends StoredInvoice {
  home: StoredHome;
}

class MemoryBilling implements Pick<BillingStore, 'findInvoicesForSociety'> {
  readonly invoices: InvoiceRow[] = [];
  findInvoicesForSociety(): Promise<readonly (StoredInvoice & { home: StoredHome })[]> {
    const sorted = [...this.invoices].sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : a.id - b.id));
    return Promise.resolve(sorted);
  }
}

class MemoryComplaints implements Pick<ComplaintStore, 'findComplaintsForSociety'> {
  readonly complaints: StoredComplaint[] = [];
  findComplaintsForSociety(): Promise<readonly StoredComplaint[]> {
    return Promise.resolve([...this.complaints]);
  }
}

class MemoryVisitors implements Pick<VisitorStore, 'findLogsForSociety'> {
  readonly entries: (StoredVisitorEntry & { home: StoredHome })[] = [];
  findLogsForSociety(): Promise<readonly (StoredVisitorEntry & { home: StoredHome })[]> {
    const sorted = [...this.entries].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.logId - a.logId,
    );
    return Promise.resolve(sorted);
  }
}

class MemoryFacilities implements Pick<FacilitiesStore, 'findBookingsForSociety'> {
  readonly bookings: (StoredBooking & { home: StoredHome })[] = [];
  findBookingsForSociety(): Promise<readonly (StoredBooking & { home: StoredHome })[]> {
    return Promise.resolve([...this.bookings]);
  }
}

const ADMIN: Actor = { userId: 1, role: 'A', unitId: null, name: 'Chair', email: 'chair@example.test' };
const RESIDENT: Actor = { userId: 2, role: 'R', unitId: 1, name: 'Res', email: 'res@example.test' };

function service(rows: {
  invoices?: InvoiceRow[];
  complaints?: StoredComplaint[];
  entries?: (StoredVisitorEntry & { home: StoredHome })[];
  bookings?: (StoredBooking & { home: StoredHome })[];
  now?: string;
}): ReportsService {
  const billing = new MemoryBilling();
  const complaints = new MemoryComplaints();
  const visitors = new MemoryVisitors();
  const facilities = new MemoryFacilities();
  billing.invoices.push(...(rows.invoices ?? []));
  complaints.complaints.push(...(rows.complaints ?? []));
  visitors.entries.push(...(rows.entries ?? []));
  facilities.bookings.push(...(rows.bookings ?? []));
  // Each memory store implements exactly the one read the service takes from it; the cast is
  // the test saying so out loud rather than stubbing thirty methods it would never call.
  return reportsService({
    billing: billing as unknown as BillingStore,
    complaints: complaints as unknown as ComplaintStore,
    visitors: visitors as unknown as VisitorStore,
    facilities: facilities as unknown as FacilitiesStore,
    clock: new MutableClock(rows.now ?? '2026-09-12T10:00:00.000Z'),
  });
}

function anInvoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 1,
    unitId: 1,
    raisedById: 1,
    period: '2026-09',
    amountPaise: C.paise(3_500),
    dueOn: new Date('2026-09-15T00:00:00.000Z'),
    status: 'UNPAID',
    cancelledReason: null,
    payment: null,
    home: HOME,
    ...overrides,
  };
}

function aPayment(overrides: Partial<StoredPayment> = {}): StoredPayment {
  return {
    id: 1,
    invoiceId: 1,
    recordedById: null,
    amountPaise: C.paise(3_500),
    method: 'UPI',
    receiptNo: 'REC-2026-09-00001',
    reference: 'TESTREF',
    paidAt: new Date('2026-09-10T00:00:00Z'),
    ...overrides,
  };
}

describe('the CSV export (UC-27)', () => {
  it('refuses anyone but the committee', async () => {
    const svc = service({});
    const result = await svc.csv(RESIDENT, C.ReportQuery.parse({ kind: 'dues' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });

  it('refuses an inverted range with a readable message, reading nothing', async () => {
    const svc = service({ invoices: [anInvoice()] });
    const result = await svc.csv(ADMIN, C.ReportQuery.parse({ kind: 'dues', from: '2026-09-30', to: '2026-09-01' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.field).toBe('to');
    }
  });

  it('exports dues rows, the end date inclusive', async () => {
    const inRange = anInvoice({ id: 1, status: 'PAID', payment: aPayment({ receiptNo: 'REC-2026-09-00001', paidAt: new Date('2026-09-10T04:00:00Z') }) });
    const afterRange = anInvoice({ id: 2, period: '2026-10', dueOn: new Date('2026-10-15T00:00:00Z') });
    const boundary = anInvoice({ id: 3, dueOn: new Date('2026-09-30T00:00:00Z') });
    const svc = service({ invoices: [inRange, afterRange, boundary] });

    const result = await svc.csv(ADMIN, C.ReportQuery.parse({ kind: 'dues', from: '2026-09-01', to: '2026-09-30' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(2); // the 10-01 invoice is outside
    expect(result.value.empty).toBe(false);
    const first = result.value.rows[0];
    expect(first?.[2]).toBe('Gulmohar Court · A-101');
    expect(first?.[3]).toBe('35.00'); // ₹35.00 — 3_500 paise, formatted without the symbol
    expect(first?.[5]).toBe('PAID');
    expect(first?.[6]).toBe('REC-2026-09-00001');
  });

  it('exports complaint rows with the category label, never the raw value (D-55)', async () => {
    const complaint: StoredComplaint = {
      id: 7,
      unitId: 1,
      category: 'PLUMBING',
      priority: 'HIGH',
      description: 'Kitchen tap dripping, sink overflowed twice.',
      photoKeys: [],
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-08T00:00:00Z'),
      reopenCount: 0,
      raisedAt: new Date('2026-09-06T00:00:00Z'),
      updates: [
        { id: 1, complaintId: 7, updatedById: 1, updatedByName: 'Chair', statusAfter: 'RESOLVED', note: 'Washer replaced.', createdAt: new Date('2026-09-08T00:00:00Z') },
      ],
    };
    const svc = service({ complaints: [complaint] });
    const result = await svc.csv(ADMIN, C.ReportQuery.parse({ kind: 'complaints', from: '2026-09-01', to: '2026-09-30' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(1);
    const row = result.value.rows[0];
    expect(row?.[3]).toBe('Plumbing');
    expect(row?.[7]).toBe('1');
  });

  it('exports visitor rows with the decision attributed', async () => {
    const entry: StoredVisitorEntry & { home: StoredHome } = {
      logId: 11,
      kind: 'WALK_IN',
      visitorName: 'Meera Nair',
      purpose: 'Flower delivery',
      approvalStatus: 'APPROVED',
      decidedByName: 'Saarathi Niranjan Kumar',
      overrideReason: null,
      enteredAt: new Date('2026-09-12T04:30:00Z'),
      exitedAt: null,
      createdAt: new Date('2026-09-12T04:29:00Z'),
      home: HOME,
    };
    const svc = service({ entries: [entry] });
    const result = await svc.csv(ADMIN, C.ReportQuery.parse({ kind: 'visitors' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(1);
    const row = result.value.rows[0];
    expect(row?.[2]).toBe('Walk-in');
    expect(row?.[6]).toBe('APPROVED by Saarathi Niranjan Kumar');
  });

  it('an empty range is a header-only file, flagged empty — never an error', async () => {
    const svc = service({});
    const result = await svc.csv(ADMIN, C.ReportQuery.parse({ kind: 'dues', from: '2026-01-01', to: '2026-01-31' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(0);
    expect(result.value.empty).toBe(true);
    expect(result.value.header.length).toBeGreaterThan(0);
  });
});

describe('the dashboard (UC-26)', () => {
  function figures(now = '2026-09-12T10:00:00.000Z') {
    return service({
      now,
      invoices: [
        anInvoice({ id: 1, status: 'PAID', payment: aPayment({ receiptNo: 'R1', paidAt: new Date('2026-09-10T00:00:00Z') }) }),
        anInvoice({ id: 2, status: 'UNPAID' }),
        anInvoice({ id: 3, period: '2026-08', dueOn: new Date('2026-08-15T00:00:00Z'), status: 'PAID', payment: aPayment({ receiptNo: 'R0', paidAt: new Date('2026-08-20T00:00:00Z') }) }),
      ],
      complaints: [
        { id: 1, unitId: 1, category: 'PLUMBING', priority: 'LOW', description: 'a', photoKeys: [], status: 'OPEN', resolvedAt: null, reopenCount: 0, raisedAt: new Date(), updates: [] },
        { id: 2, unitId: 1, category: 'ELECTRICAL', priority: 'HIGH', description: 'b', photoKeys: [], status: 'IN_PROGRESS', resolvedAt: null, reopenCount: 0, raisedAt: new Date(), updates: [] },
        { id: 3, unitId: 1, category: 'COMMON_AREA', priority: 'MEDIUM', description: 'c', photoKeys: [], status: 'RESOLVED', resolvedAt: new Date(), reopenCount: 0, raisedAt: new Date(), updates: [] },
      ],
      entries: [
        { logId: 1, kind: 'PASS', visitorName: 'A', purpose: 'p', approvalStatus: 'NOT_REQUIRED', decidedByName: null, overrideReason: null, enteredAt: null, exitedAt: null, createdAt: new Date('2026-09-12T02:00:00Z'), home: HOME },
        { logId: 2, kind: 'WALK_IN', visitorName: 'B', purpose: 'p', approvalStatus: 'APPROVED', decidedByName: null, overrideReason: null, enteredAt: null, exitedAt: null, createdAt: new Date('2026-09-12T05:00:00Z'), home: HOME },
        { logId: 3, kind: 'WALK_IN', visitorName: 'C', purpose: 'p', approvalStatus: 'APPROVED', decidedByName: null, overrideReason: null, enteredAt: null, exitedAt: null, createdAt: new Date('2026-09-11T05:00:00Z'), home: HOME },
      ],
      bookings: [
        { id: 1, facilityId: 1, facilityName: 'Clubhouse', unitId: 1, bookingDate: new Date('2026-09-20T00:00:00Z'), startTime: '18:00', endTime: '20:00', status: 'CONFIRMED', amountPaise: C.paise(300), requestedAt: new Date(), decidedAt: null, decisionReason: null, home: HOME },
      ],
    });
  }

  it('refuses anyone but the committee', async () => {
    const result = await figures().dashboard(RESIDENT);
    expect(result.ok).toBe(false);
  });

  it('aggregates each figure from exactly its own period', async () => {
    const result = await figures().dashboard(ADMIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const f = result.value;

    expect(f.period).toBe('2026-09');
    // One paid (₹35) and one unpaid (₹35) this period; last period one paid (₹35). The paise
    // integers are what the wire carries; the screen formats them.
    expect(f.collectionsPaise).toBe(3_500);
    expect(f.duesPaise).toBe(3_500);
    expect(f.previousCollectionsPaise).toBe(3_500);
    expect(f.openComplaints).toBe(1);
    expect(f.inProgressComplaints).toBe(1);
    expect(f.resolvedComplaints).toBe(1);
    expect(f.visitorsToday).toBe(2);
    expect(f.visitorsYesterday).toBe(1);
    expect(f.bookingsThisMonth).toBe(1);
    expect(f.bookingsLastMonth).toBe(0);
  });

  it('an empty month is zeros, never an error', async () => {
    const result = await service({}).dashboard(ADMIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.collectionsPaise).toBe(0);
    expect(result.value.duesPaise).toBe(0);
    expect(result.value.visitorsToday).toBe(0);
  });
});
