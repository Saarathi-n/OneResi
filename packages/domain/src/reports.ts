import * as C from '@oneresi/contracts';
import type { Clock } from './clock.js';
import { ok, type ReportsService } from './ports.js';
import { errors } from './errors.js';
import type {
  BillingStore,
  ComplaintStore,
  FacilitiesStore,
  StoredComplaint,
  StoredInvoice,
  StoredVisitorEntry,
  VisitorStore,
} from './store.js';

/**
 * The committee's exports and figures. Two methods over reads the desks already own — invoices
 * for the society, complaints for the society, the gate log for the society, bookings for the
 * society — so the aggregation lives here, once, and neither the routes nor the screens
 * recompute it (UC-26, UC-27).
 *
 * The CSV contract: the service returns parsed cells, never formatted strings. Numbers stay
 * bare, dates stay ISO, and the route quotes any cell that contains a comma — a CSV assembled
 * by string concatenation is how a comma in a resident's note silently splits one report into
 * two broken rows.
 *
 * The range rule: end is INCLUSIVE (a report "from the 1st to the 30th" includes the 30th),
 * and an end before the start is refused before anything is read — the readable message UC-27
 * alternative flow 3a asks for, not a schema error.
 */

export interface ReportsDeps {
  readonly billing: BillingStore;
  readonly complaints: ComplaintStore;
  readonly visitors: VisitorStore;
  readonly facilities: FacilitiesStore;
  readonly clock: Clock;
}

/** ISO date of `at` truncated to its UTC calendar day. */
function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `YYYY-MM` of the month `offsetMonths` away from `at`. */
function monthOf(at: Date, offsetMonths = 0): string {
  const d = new Date(at);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function reportsService(deps: ReportsDeps): ReportsService {
  const { billing, complaints, visitors, facilities, clock } = deps;

  return {
    async csv(actor, query) {
      if (actor.role !== 'A') return errors.forbidden('export reports');

      // An inverted range is a form mistake the desk can fix, not a schema violation.
      if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
        return errors.invalid('The end of the range cannot be before its start.', 'to');
      }

      const from = query.from ?? '0000-01-01';
      const to = query.to ?? '9999-12-31';

      if (query.kind === 'dues') {
        const invoices = await billing.findInvoicesForSociety();
        const rows = invoices.filter((invoice) => inRange(invoice.dueOn)).map(invoiceRow);
        return ok({
          filename: `dues-${from}-to-${to}.csv`,
          header: [
            'invoiceId',
            'period',
            'home',
            'amount (INR)',
            'due date',
            'status',
            'receipt no',
            'paid on',
          ],
          rows,
          empty: rows.length === 0,
        });
      }

      if (query.kind === 'complaints') {
        const list = await complaints.findComplaintsForSociety({});
        const rows = list.filter((complaint) => inRange(complaint.raisedAt)).map(complaintRow);
        return ok({
          filename: `complaints-${from}-to-${to}.csv`,
          header: [
            'complaintId',
            'raised on',
            'status',
            'category',
            'priority',
            'description',
            'resolved on',
            'updates',
          ],
          rows,
          empty: rows.length === 0,
        });
      }

      const entries = await visitors.findLogsForSociety(100_000);
      const rows = entries.filter((entry) => inRange(entry.createdAt)).map(visitorRow);
      return ok({
        filename: `visitors-${from}-to-${to}.csv`,
        header: [
          'logId',
          'when',
          'kind',
          'visitor',
          'home',
          'purpose',
          'decision',
          'entered at',
          'exited at',
        ],
        rows,
        empty: rows.length === 0,
      });

      /** The UTC calendar day is inside the range, end inclusive. */
      function inRange(at: Date): boolean {
        const day = dayOf(at);
        return day >= from && day <= to;
      }

      function invoiceRow(invoice: StoredInvoice & { home: { blockName: string; label: string } }): readonly string[] {
        return [
          String(invoice.id),
          invoice.period,
          `${invoice.home.blockName} · ${invoice.home.label}`,
          C.formatMoney(invoice.amountPaise).replace(/[₹,\s]/g, ''),
          dayOf(invoice.dueOn),
          invoice.status,
          invoice.payment === null ? '' : invoice.payment.receiptNo,
          invoice.payment === null ? '' : dayOf(invoice.payment.paidAt),
        ];
      }

      function complaintRow(complaint: StoredComplaint): readonly string[] {
        return [
          String(complaint.id),
          dayOf(complaint.raisedAt),
          complaint.status,
          C.COMPLAINT_CATEGORY[complaint.category].label,
          complaint.priority,
          complaint.description,
          complaint.resolvedAt === null ? '' : dayOf(complaint.resolvedAt),
          String(complaint.updates.length),
        ];
      }

      function visitorRow(entry: StoredVisitorEntry & { home: { blockName: string; label: string } }): readonly string[] {
        return [
          String(entry.logId),
          entry.createdAt.toISOString(),
          entry.kind === 'PASS' ? 'Pass' : 'Walk-in',
          entry.visitorName,
          `${entry.home.blockName} · ${entry.home.label}`,
          entry.purpose,
          entry.decidedByName === null ? entry.approvalStatus : `${entry.approvalStatus} by ${entry.decidedByName}`,
          entry.enteredAt === null ? '' : entry.enteredAt.toISOString(),
          entry.exitedAt === null ? '' : entry.exitedAt.toISOString(),
        ];
      }
    },

    async dashboard(actor) {
      if (actor.role !== 'A') return errors.forbidden('view the dashboard');

      const now = clock.now();
      const period = monthOf(now);
      const previous = monthOf(now, -1);
      const today = dayOf(now);
      const yesterday = dayOf(new Date(now.getTime() - 86_400_000));

      const [invoices, complaintList, logs, bookings] = await Promise.all([
        billing.findInvoicesForSociety(),
        complaints.findComplaintsForSociety({}),
        visitors.findLogsForSociety(100_000),
        facilities.findBookingsForSociety(),
      ]);

      const thisPeriod = invoices.filter((invoice) => invoice.period === period);
      const lastPeriod = invoices.filter((invoice) => invoice.period === previous);
      // Collections: what was actually paid against this period, whatever day it landed on.
      const collectionsPaise = thisPeriod.reduce(
        (sum, invoice) => sum + (invoice.payment === null ? 0 : invoice.payment.amountPaise),
        0,
      );
      const previousCollectionsPaise = lastPeriod.reduce(
        (sum, invoice) => sum + (invoice.payment === null ? 0 : invoice.payment.amountPaise),
        0,
      );
      // Dues: what is still owed this period — unsettled invoices only.
      const duesPaise = thisPeriod
        .filter((invoice) => invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')
        .reduce((sum, invoice) => sum + invoice.amountPaise, 0);

      // Gate traffic: log rows created that day. Visitors who entered and left are one row.
      const countOn = (day: string): number =>
        logs.filter((entry) => dayOf(entry.createdAt) === day).length;

      // Facility usage: bookings whose booked date falls in the month.
      const bookingsIn = (month: string): number =>
        bookings.filter((booking) => monthOf(booking.bookingDate) === month).length;

      return ok({
        period,
        collectionsPaise,
        duesPaise,
        previousCollectionsPaise,
        openComplaints: complaintList.filter((complaint) => complaint.status === 'OPEN').length,
        inProgressComplaints: complaintList.filter((complaint) => complaint.status === 'IN_PROGRESS').length,
        resolvedComplaints: complaintList.filter(
          (complaint) => complaint.status === 'RESOLVED' || complaint.status === 'CLOSED',
        ).length,
        visitorsToday: countOn(today),
        visitorsYesterday: countOn(yesterday),
        bookingsThisMonth: bookingsIn(period),
        bookingsLastMonth: bookingsIn(previous),
      });
    },
  };
}
