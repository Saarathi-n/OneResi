import * as C from '@grihaone/contracts';
import { errors } from './errors.js';
import type { Clock } from './clock.js';
import {
  type BillingService,
  type InvoiceView,
  type ReceiptView,
  type SocietyInvoiceView,
  ok,
  type Result,
  type Actor,
  type SystemActor,
} from './ports.js';
import type {
  BillingStore,
  OutboxEventInput,
} from './store.js';

/**
 * Billing. The rules, once each:
 *
 *  - a cycle is generated for the whole society in ONE transaction, or refused outright — the
 *    architecture says a partial count is not a result (D-17, D-29)
 *  - the amount is snapshotted from the unit's charge at generation, so a change in March can
 *    never reprice January (D-50)
 *  - payment is scoped to the caller's own unit — the previous endpoint let any resident settle
 *    any invoice in the society (D-07)
 *  - a receipt number comes from the per-period sequence, allocated inside the payment
 *    transaction, so the numbers are unique by construction and gap-free (D-37)
 *  - the receipt is rendered from the persisted payment row and nothing else — the previous
 *    build fabricated one in the browser when the row was missing (D-26)
 *  - overdue is one rule here, reused by the scheduled job: due date strictly before today, in
 *    the society's timezone, so an invoice due today is not flagged at 00:01 (D-36)
 */

type MailPayload = Readonly<Record<string, string | number | boolean | null>>;

function mailEvent(
  type: C.OutboxEventType,
  payload: MailPayload,
  correlationId: string,
): OutboxEventInput {
  return { type, channel: 'EMAIL', payload, correlationId };
}

/** `A-101`. One format, at the seam every mail payload and receipt reads. */
function homeLabel(home: { readonly blockName: string; readonly label: string }): string {
  return `${home.blockName} · ${home.label}`;
}

/** A calendar day (`YYYY-MM-DD`) as the UTC midnight it is stored at. */
function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The day of an instant, as the calendar the society lives in sees it. IST has no DST. */
const IST_OFFSET_MINUTES = 330;

function istDayString(at: Date): string {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/**
 * The instant the current IST day began, in UTC. An invoice is overdue when its due date —
 * stored at UTC midnight — falls before this instant: that is "due strictly before today", the
 * comparison the previous job got wrong by one day (D-36).
 */
function istDayStart(at: Date): Date {
  return new Date(dayNumber(istDayString(at)) - IST_OFFSET_MINUTES * 60_000);
}

/** Whole calendar days from a due date to a day the society has reached. */
function daysBetween(fromDay: string, toDay: string): number {
  return (dayNumber(toDay) - dayNumber(fromDay)) / MS_PER_DAY;
}

interface Resident {
  readonly id: number;
  readonly name: string;
  readonly email: string;
}

/** The invoice as the household reads it: the settlement the status claims, joined in (D-26). */
function invoiceView(invoice: {
  readonly id: number;
  readonly period: string;
  readonly amountPaise: C.Paise;
  readonly dueOn: Date;
  readonly status: C.InvoiceStatus;
  readonly payment: { readonly receiptNo: string; readonly paidAt: Date } | null;
}): InvoiceView {
  return {
    id: invoice.id,
    period: invoice.period,
    amountPaise: invoice.amountPaise,
    dueOn: invoice.dueOn,
    status: invoice.status,
    receiptNo: invoice.payment === null ? null : invoice.payment.receiptNo,
    paidAt: invoice.payment === null ? null : invoice.payment.paidAt,
  };
}

export interface BillingDeps {
  readonly store: BillingStore;
  readonly clock: Clock;
}

export function billingService(deps: BillingDeps): BillingService {
  const { store, clock } = deps;

  /** The settlement events every household resident receives, one row each (D-29). */
  function paymentEvents(
    residents: readonly Resident[],
    home: string,
    payment: {
      readonly receiptNo: string;
      readonly amountPaise: C.Paise;
      readonly method: C.PaymentMethod;
      readonly paidAt: Date;
      readonly reference: string;
    },
    period: string,
    correlationId: string,
  ): OutboxEventInput[] {
    return residents.map((resident) =>
      mailEvent(
        'payment.received',
        {
          name: resident.name,
          email: resident.email,
          recipientName: resident.name,
          home,
          period,
          receiptNo: payment.receiptNo,
          amountPaise: payment.amountPaise,
          method: payment.method,
          paidAt: payment.paidAt.toISOString(),
          reference: payment.reference,
        },
        correlationId,
      ),
    );
  }

  return {
    async raiseForPeriod(actor, input): Promise<Result<{ raised: number }>> {
      if (actor.role !== 'A') return errors.forbidden('run a billing cycle');

      // The friendly refusal; the guarantee is the (unitId, period) constraint in the write
      // below (D-17).
      const existing = await store.countInvoicesForPeriod(input.period);
      if (existing > 0) {
        return errors.limitReached('That period has already been generated.');
      }

      const now = clock.now();
      const dueOn = utcMidnight(input.dueDate);
      if (input.dueDate < now.toISOString().slice(0, 10)) {
        return errors.invalid('The due date cannot be in the past.', 'dueDate');
      }

      const census = await store.billableUnits();
      if (census.length === 0) return ok({ raised: 0 });

      // Mail needs the household's residents and label; the census supplies the rest.
      const residentsByUnit = new Map<number, readonly Resident[]>();
      const labelByUnit = new Map<number, string>();
      for (const unit of census) {
        residentsByUnit.set(unit.unitId, await store.findResidentsForUnit(unit.unitId));
        labelByUnit.set(unit.unitId, homeLabel(unit));
      }

      const correlationId = C.idempotencyKey();
      const invoices = await store.raiseInvoices(
        { period: input.period, dueOn, raisedById: actor.userId, raisedAt: now },
        census.map((unit) => ({ unitId: unit.unitId, amountPaise: unit.monthlyChargePaise })),
        (invoice) =>
          (residentsByUnit.get(invoice.unitId) ?? []).map((resident) =>
            mailEvent(
              'invoice.raised',
              {
                name: resident.name,
                email: resident.email,
                recipientName: resident.name,
                home: labelByUnit.get(invoice.unitId) ?? '',
                invoiceId: invoice.id,
                period: invoice.period,
                amountPaise: invoice.amountPaise,
                dueOn: invoice.dueOn.toISOString(),
              },
              correlationId,
            ),
          ),
      );
      if (invoices === null) {
        // A concurrent run won the race; the constraint refused ours.
        return errors.limitReached('That period has already been generated.');
      }
      return ok({ raised: invoices.length });
    },

    async forHousehold(actor): Promise<Result<readonly InvoiceView[]>> {
      if (actor.unitId === null) return errors.forbidden('view invoices');
      const invoices = await store.findInvoicesForUnit(actor.unitId);
      return ok(invoices.map(invoiceView));
    },

    async forSociety(actor): Promise<Result<readonly SocietyInvoiceView[]>> {
      if (actor.role !== 'A') return errors.forbidden('view the ledger');
      const invoices = await store.findInvoicesForSociety();
      return ok(
        invoices.map((invoice) => ({
          ...invoiceView(invoice),
          home: {
            unitId: invoice.home.unitId,
            blockName: invoice.home.blockName,
            label: invoice.home.label,
            type: invoice.home.type,
            monthlyChargePaise: invoice.home.monthlyChargePaise,
          },
        })),
      );
    },

    async pay(actor, input): Promise<Result<InvoiceView>> {
      if (actor.unitId === null) return errors.forbidden('pay an invoice');
      return settle(actor, {
        invoiceId: input.invoiceId,
        amountPaise: null, // in full, from the invoice itself
        method: input.method,
        paidAt: clock.now(),
        recordedById: null,
        reference:
          input.idempotencyKey === undefined
            ? C.paymentReference()
            : // Same intent, same reference: the unique column then refuses the second row a
              // replayed confirmation would create.
              `PAY${input.idempotencyKey.slice(0, 12).toUpperCase()}`,
        // A replayed confirmation of one intent must succeed, not read as "already settled".
        replayable: input.idempotencyKey !== undefined,
        scope: 'household',
      });
    },

    async recordOffline(actor, input): Promise<Result<InvoiceView>> {
      if (actor.role !== 'A') return errors.forbidden('record an offline payment');
      const receivedOn = utcMidnight(input.receivedOn);
      if (input.receivedOn > clock.now().toISOString().slice(0, 10)) {
        return errors.invalid('The received date cannot be in the future.', 'receivedOn');
      }
      return settle(actor, {
        invoiceId: input.invoiceId,
        amountPaise: C.paise(input.amountPaise),
        method: input.method,
        paidAt: receivedOn,
        recordedById: actor.userId,
        reference: C.paymentReference(),
        replayable: false,
        // The committee records for any household; the household scoping below is the
        // resident's rule (D-07).
        scope: 'society',
      });
    },

    async cancel(actor, input): Promise<Result<InvoiceView>> {
      if (actor.role !== 'A') return errors.forbidden('cancel an invoice');

      const invoice = await store.findInvoiceById(input.invoiceId);
      if (invoice === null) return errors.notFound('invoice');
      if (invoice.status === 'PAID') {
        return errors.stateNotAllowed('A settled invoice cannot be cancelled.');
      }
      if (invoice.status === 'CANCELLED') {
        return errors.alreadyDone('This invoice is already cancelled.');
      }

      const updated = await store.cancelInvoice(
        { invoiceId: input.invoiceId, reason: input.reason, cancelledAt: clock.now() },
        [],
      );
      if (updated === null) {
        return errors.conflict('This invoice changed while it was being cancelled.');
      }
      return ok(invoiceView(updated));
    },

    async receipt(actor, receiptNo): Promise<Result<ReceiptView>> {
      const stored = await store.findReceiptByNo(receiptNo);
      if (stored === null) return errors.notFound('receipt');
      // A receipt is the household's document; anyone else's reads as nonexistent.
      if (actor.role !== 'A' && actor.unitId !== stored.invoice.unitId) {
        return errors.notFound('receipt');
      }
      return ok({
        receiptNo: stored.payment.receiptNo,
        paidAt: stored.payment.paidAt,
        method: stored.payment.method,
        amountPaise: stored.payment.amountPaise,
        amountInWords: C.moneyInWords(stored.payment.amountPaise),
        period: stored.invoice.period,
        payerName: stored.payerName,
        home: {
          unitId: stored.home.unitId,
          blockName: stored.home.blockName,
          label: stored.home.label,
          type: stored.home.type,
          monthlyChargePaise: stored.home.monthlyChargePaise,
        },
        reference: stored.payment.reference,
      });
    },

    async flagOverdue(_actor: SystemActor, asOf: Date): Promise<Result<{ flagged: number }>> {
      // The one rule the scheduled job reuses (D-36). The cutoff is computed here so the store
      // never decides what "today" means.
      const dueBefore = istDayStart(asOf);
      const today = istDayString(asOf);
      const correlationId = C.idempotencyKey();
      const flagged = await store.markInvoicesOverdue(
        { dueBefore },
        async (invoice) => {
          const [residents, home] = await Promise.all([
            store.findResidentsForUnit(invoice.unitId),
            store.findHome(invoice.unitId),
          ]);
          const label = home === null ? '' : homeLabel(home);
          const daysOverdue = daysBetween(invoice.dueOn.toISOString().slice(0, 10), today);
          return residents.map((resident) =>
            mailEvent(
              'invoice.overdue',
              {
                name: resident.name,
                email: resident.email,
                recipientName: resident.name,
                home: label,
                invoiceId: invoice.id,
                period: invoice.period,
                amountPaise: invoice.amountPaise,
                dueOn: invoice.dueOn.toISOString(),
                daysOverdue,
              },
              correlationId,
            ),
          );
        },
      );
      return ok({ flagged: flagged.length });
    },
  };

  /**
   * One settlement path for the online payment and the recorded cash (D-07). `scope` is the
   * household rule itself: a resident settles their own unit — a foreign invoice reads as
   * nonexistent — while the committee's desk records for any household.
   */
  async function settle(
    actor: Actor,
    input: {
      readonly invoiceId: number;
      readonly amountPaise: C.Paise | null;
      readonly method: C.PaymentMethod;
      readonly paidAt: Date;
      readonly recordedById: number | null;
      readonly reference: string;
      readonly replayable: boolean;
      readonly scope: 'household' | 'society';
    },
  ): Promise<Result<InvoiceView>> {
    const invoice = await store.findInvoiceById(input.invoiceId);
    const outOfScope =
      invoice === null || (input.scope === 'household' && invoice.unitId !== actor.unitId);
    if (outOfScope) {
      return errors.notFound('invoice');
    }
    if (input.amountPaise !== null && input.amountPaise !== invoice.amountPaise) {
      return errors.invalid(
        'The amount has to match the invoice in full. Partial settlement is not supported.',
        'amountPaise',
      );
    }
    // A settled invoice is never cancellable, so a settled-and-cancelled replay cannot exist.
    if (invoice.status === 'CANCELLED') {
      return errors.stateNotAllowed('This invoice was cancelled.');
    }
    if (invoice.status === 'PAID' && !input.replayable) {
      return errors.alreadyDone('This invoice is already settled.');
    }

    const [residents, home] = await Promise.all([
      store.findResidentsForUnit(invoice.unitId),
      store.findHome(invoice.unitId),
    ]);
    const label = home === null ? '' : homeLabel(home);
    const correlationId = C.idempotencyKey();

    const payment = await store.recordPayment(
      {
        invoiceId: invoice.id,
        recordedById: input.recordedById,
        amountPaise: invoice.amountPaise,
        method: input.method,
        paidAt: input.paidAt,
        reference: input.reference,
      },
      (made) =>
        paymentEvents(residents, label, made, invoice.period, correlationId),
    );
    if (payment === null) {
      // The store refused: either the invoice stopped being payable between the check and the
      // write, or a replay carried a reference this invoice never used.
      if (invoice.status === 'PAID') return errors.alreadyDone('This invoice is already settled.');
      return errors.conflict('This invoice changed while it was being settled.');
    }
    if (payment.invoiceId !== invoice.id) {
      // The reference was already used for a different invoice — a client reusing one intent
      // across two payments.
      return errors.conflict('That payment reference was already used.');
    }
    return ok({
      id: invoice.id,
      period: invoice.period,
      amountPaise: invoice.amountPaise,
      dueOn: invoice.dueOn,
      status: 'PAID',
      receiptNo: payment.receiptNo,
      paidAt: payment.paidAt,
    });
  }
}

export interface StreakInvoice {
  readonly period: string;
  readonly status: C.InvoiceStatus;
  readonly dueOn: Date | string;
  readonly paidAt: Date | string | null;
}

/**
 * Counts the unbroken sequence of billing periods settled on time, newest first.
 * Stops at the first unpaid invoice, overdue invoice, or invoice where paidAt was after dueOn.
 * Cancelled invoices do not break or count towards the streak.
 */
export function paymentStreak(invoices: readonly StreakInvoice[]): number {
  const sorted = [...invoices]
    .filter((inv) => inv.status !== 'CANCELLED')
    .sort((a, b) => b.period.localeCompare(a.period));

  let streak = 0;
  for (const inv of sorted) {
    if (inv.status !== 'PAID' || inv.paidAt === null) {
      break;
    }
    const due = typeof inv.dueOn === 'string' ? new Date(inv.dueOn).getTime() : inv.dueOn.getTime();
    const paid = typeof inv.paidAt === 'string' ? new Date(inv.paidAt).getTime() : inv.paidAt.getTime();
    if (paid <= due) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

