import type { Paise } from '@oneresi/contracts';
import { action, details, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, date, int, money, period as periodValue, str } from '../decode.js';
import { formatDate, formatPeriod, money as formatAmount, plural } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The reminder, sent by the scheduled job that marks an invoice overdue.
 *
 * `daysOverdue` is worked out by the caller in the society's timezone. The previous build compared a
 * due date held at midnight against `now`, so an invoice due today was flagged overdue at 00:01 on
 * its own due date (D-36). A template that did the arithmetic itself would just move that bug.
 */

export interface InvoiceOverdueVars {
  readonly recipientName: string;
  readonly home: string;
  readonly invoiceId: number;
  readonly period: string;
  readonly amountPaise: Paise;
  readonly dueOn: Date;
  readonly daysOverdue: number;
}

export type InvoiceOverduePayload = Wire<InvoiceOverdueVars>;

function compose(vars: InvoiceOverdueVars): Block[] {
  return [
    heading(`Maintenance for ${formatPeriod(vars.period)} is unpaid`),
    para(`Hello ${vars.recipientName},`),
    para(
      `The bill for ${formatPeriod(vars.period)} was due on ${formatDate(vars.dueOn)}, ` +
        `${plural(vars.daysOverdue, 'day', 'days')} ago, and is still showing as unpaid.`,
    ),
    details([
      { label: 'Home', value: vars.home },
      { label: 'For', value: formatPeriod(vars.period) },
      { label: 'Amount', value: formatAmount(vars.amountPaise) },
      { label: 'Was due', value: formatDate(vars.dueOn) },
    ]),
    action('Pay now', PATHS.dues),
    note(
      'If you have already paid, or the amount does not look right, tell the committee and they ' +
        'will check the ledger rather than chase you again.',
    ),
  ];
}

export const subject = (vars: InvoiceOverdueVars): string =>
  `Maintenance for ${formatPeriod(vars.period)} is overdue`;

export const text = (vars: InvoiceOverdueVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: InvoiceOverdueVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: InvoiceOverdueVars): Record<string, string> => ({
  name: vars.recipientName,
  unit: vars.home,
  period: formatPeriod(vars.period),
  amount: formatAmount(vars.amountPaise),
  dueDate: formatDate(vars.dueOn),
  daysOverdue: String(vars.daysOverdue),
});

export function decode(payload: unknown): InvoiceOverdueVars {
  const raw = asObject(payload);
  return {
    recipientName: str(raw, 'recipientName', 120),
    home: str(raw, 'home', 120),
    invoiceId: int(raw, 'invoiceId'),
    period: periodValue(raw, 'period'),
    amountPaise: money(raw, 'amountPaise'),
    dueOn: date(raw, 'dueOn'),
    daysOverdue: int(raw, 'daysOverdue'),
  };
}

export const template: MailTemplate<InvoiceOverdueVars> = {
  id: 'invoice.overdue',
  decode,
  subject,
  text,
  html,
  variables,
};
