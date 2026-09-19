import * as C from '@grihaone/contracts';
import type { Db, Prisma } from '../client.js';
import type {
  BillingStore,
  OutboxEventInput,
  StoredInvoice,
} from '@grihaone/domain';
import {
  isUniqueViolation,
  invoiceInclude,
  sharedLookups,
  toHome,
  toInvoice,
  toPayment,
  unitInclude,
  writeEvents,
} from './shared.js';

/**
 * BillingStore over Prisma: the monthly census, the all-or-nothing billing run, settlement with
 * a receipt number allocated inside the payment transaction, cancellation, and the one overdue
 * rule the scheduled job reuses. Amounts are snapshotted at generation and never joined back to
 * the unit's current charge (D-50).
 */

/** A receipt: the payment, its invoice with the home joined, for one query (D-26). */
const RECEIPT_INCLUDE = {
  invoice: {
    include: {
      unit: { include: unitInclude },
      payments: { orderBy: { id: 'asc' }, take: 1 },
    },
  },
} satisfies Prisma.PaymentInclude;

/** The society's ledger: the invoice, its settlement, and the home it belongs to. */
const SOCIETY_INVOICE_INCLUDE = {
  payments: { orderBy: { id: 'asc' }, take: 1 },
  unit: { include: unitInclude },
} satisfies Prisma.InvoiceInclude;

export function billingStore(db: Db): BillingStore {
  const store: BillingStore = {
    ...sharedLookups(db),

    async billableUnits() {
      // Active units with a charge to collect. A unit with no charge has nothing to bill and
      // is not in the census.
      const rows = await db.unit.findMany({
        where: { active: true, monthlyChargePaise: { gt: 0 } },
        include: { block: { select: { name: true } } },
        orderBy: { id: 'asc' },
      });
      return rows.map((row) => ({
        unitId: row.id,
        blockName: row.block.name,
        label: row.label,
        monthlyChargePaise: row.monthlyChargePaise as C.Paise,
      }));
    },

    countInvoicesForPeriod(period) {
      return db.invoice.count({ where: { period } });
    },

    async findInvoiceById(id) {
      const row = await db.invoice.findUnique({ where: { id }, include: invoiceInclude });
      return row === null ? null : toInvoice(row, row.payments[0] ?? null);
    },

    async findInvoicesForUnit(unitId) {
      const rows = await db.invoice.findMany({
        where: { unitId },
        include: invoiceInclude,
        orderBy: [{ period: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => toInvoice(row, row.payments[0] ?? null));
    },

    async findInvoicesForSociety() {
      // Newest period first, like the household list — the desk's own sorting and filtering are
      // the client's job, not the query's.
      const rows = await db.invoice.findMany({
        include: SOCIETY_INVOICE_INCLUDE,
        orderBy: [{ period: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        ...toInvoice(row, row.payments[0] ?? null),
        home: toHome(row.unit),
      }));
    },

    async raiseInvoices(input, units, eventsFor) {
      if (units.length === 0) return [];
      try {
        return await db.$transaction(async (tx) => {
          // The whole run or none of it: if any unit in the list already has this period, the
          // (unitId, period) constraint would refuse the second insert anyway — refusing here
          // keeps the refusal atomic rather than partial (D-17).
          const clash = await tx.invoice.count({
            where: { period: input.period, unitId: { in: units.map((unit) => unit.unitId) } },
          });
          if (clash > 0) return null;

          const events: OutboxEventInput[] = [];
          const invoices: StoredInvoice[] = [];
          for (const unit of units) {
            const row = await tx.invoice.create({
              data: {
                unitId: unit.unitId,
                raisedById: input.raisedById,
                period: input.period,
                amountPaise: unit.amountPaise,
                dueOn: input.dueOn,
                createdAt: input.raisedAt,
              },
            });
            const invoice = toInvoice(row, null);
            invoices.push(invoice);
            events.push(...eventsFor(invoice));
          }
          await writeEvents(tx, events);
          return invoices;
        });
      } catch (error) {
        // A concurrent run won the race and the constraint refused ours — the whole
        // transaction rolled back, so no invoice and no event from this attempt.
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async recordPayment(input, eventsFor) {
      // A repeated confirmation of the same intent must produce one row, not two: the reference
      // is unique, and an existing row is returned unchanged with nothing written.
      const existing = await db.payment.findUnique({ where: { reference: input.reference } });
      if (existing !== null) return toPayment(existing);

      try {
        return await db.$transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id: input.invoiceId },
            select: { period: true },
          });
          if (invoice === null) return null;

          // The guarded UNPAID/OVERDUE -> PAID transition: a settled or cancelled invoice
          // cannot be settled again.
          const applied = await tx.invoice.updateMany({
            where: { id: input.invoiceId, status: { in: ['UNPAID', 'OVERDUE'] } },
            data: { status: 'PAID' },
          });
          if (applied.count === 0) {
            const winner = await tx.payment.findUnique({ where: { reference: input.reference } });
            return winner === null ? null : toPayment(winner);
          }

          // The period's next receipt number, allocated inside this transaction so the
          // increment rolls back with the payment and the run stays gap-free (D-37). The
          // upsert's returned `next` is the value AFTER this allocation.
          const sequence = await tx.receiptSequence.upsert({
            where: { period: invoice.period },
            create: { period: invoice.period, next: 2 },
            update: { next: { increment: 1 } },
          });
          const payment = await tx.payment.create({
            data: {
              invoiceId: input.invoiceId,
              recordedById: input.recordedById,
              amountPaise: input.amountPaise,
              method: input.method,
              receiptNo: C.receiptNumber(invoice.period, sequence.next - 1),
              reference: input.reference,
              paidAt: input.paidAt,
            },
          });
          await writeEvents(tx, eventsFor(toPayment(payment)));
          return toPayment(payment);
        });
      } catch (error) {
        // Two confirmations of one reference racing: return the winner's payment idempotently.
        if (isUniqueViolation(error)) {
          const winner = await db.payment.findUnique({ where: { reference: input.reference } });
          return winner === null ? null : toPayment(winner);
        }
        throw error;
      }
    },

    async cancelInvoice(input, events) {
      return db.$transaction(async (tx) => {
        const applied = await tx.invoice.updateMany({
          where: { id: input.invoiceId, status: { in: ['UNPAID', 'OVERDUE'] } },
          data: { status: 'CANCELLED', cancelledReason: input.reason },
        });
        if (applied.count === 0) return null;
        await writeEvents(tx, events);
        const row = await tx.invoice.findUniqueOrThrow({
          where: { id: input.invoiceId },
          include: invoiceInclude,
        });
        return toInvoice(row, row.payments[0] ?? null);
      });
    },

    async markInvoicesOverdue(input, eventsFor) {
      // Due date strictly before the cutoff the caller computed — the store never decides what
      // today means (D-36).
      const candidates = await db.invoice.findMany({
        where: { status: 'UNPAID', dueOn: { lt: input.dueBefore } },
        include: invoiceInclude,
        orderBy: { id: 'asc' },
      });
      if (candidates.length === 0) return [];

      // The events are addressed per household, which only the callback knows. Collecting them
      // before the transaction keeps the callback's own reads off the connection the
      // transaction holds; the per-row guard below is what keeps each event honest — a row
      // settled in between flags nothing and mails nobody.
      const eventsByInvoice = new Map<number, readonly OutboxEventInput[]>();
      for (const row of candidates) {
        eventsByInvoice.set(row.id, await eventsFor(toInvoice(row, row.payments[0] ?? null)));
      }

      const flagged: StoredInvoice[] = [];
      await db.$transaction(async (tx) => {
        for (const row of candidates) {
          const applied = await tx.invoice.updateMany({
            where: { id: row.id, status: 'UNPAID' },
            data: { status: 'OVERDUE' },
          });
          if (applied.count === 0) continue;
          await writeEvents(tx, eventsByInvoice.get(row.id) ?? []);
          flagged.push({ ...toInvoice(row, row.payments[0] ?? null), status: 'OVERDUE' });
        }
      });
      return flagged;
    },

    async findReceiptByNo(receiptNo) {
      const row = await db.payment.findUnique({
        where: { receiptNo },
        include: RECEIPT_INCLUDE,
      });
      if (row === null) return null;

      // The household names itself: the unit's first-listed ACTIVE resident. A unit with none
      // (everyone moved out, say) still has its receipt — with the name line empty.
      const payer = await db.residentUser.findFirst({
        where: { unitId: row.invoice.unitId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { name: true },
      });
      return {
        payment: toPayment(row),
        invoice: toInvoice(row.invoice, row.invoice.payments[0] ?? null),
        home: toHome(row.invoice.unit),
        payerName: payer?.name ?? '',
      };
    },
  };

  return store;
}
