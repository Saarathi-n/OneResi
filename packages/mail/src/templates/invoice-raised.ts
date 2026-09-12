import type { Paise } from '@grihaone/contracts';
import { action, details, note, para, renderHtml, renderText } from '../document.js';
import { asObject, date, int, money, period as periodValue, str } from '../decode.js';
import { formatDate, formatPeriod, money as formatAmount } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The monthly bill.
 *
 * The one that has to survive the whole society being billed at once. The handler raises every
 * invoice in one transaction and writes one outbox row per resident of the affected unit, then
 * returns; nothing here is inside the billing request. The previous run awaited one send per resident
 * inside a per-unit loop, and in mock mode the resident query filtered on role alone, so every
 * resident in the society was emailed for every unit's invoice (D-29).
 *
 * `amountPaise` is the amount snapshotted onto the invoice, formatted once. No arithmetic (D-50).
 */

export interface InvoiceRaisedVars {
  readonly recipientName: string;
  readonly home: string;
  readonly invoiceId: number;
  /** `YYYY-MM`. */
  readonly period: string;
  readonly amountPaise: Paise;
  readonly dueOn: Date;
}

export type InvoiceRaisedPayload = Wire<InvoiceRaisedVars>;

function compose(vars: InvoiceRaisedVars): Block[] {
  return [
    para(`Hello ${vars.recipientName},`),
    para(`Your maintenance bill for ${formatPeriod(vars.period)} is ready.`),
    details([
      { label: 'Home', value: vars.home },
      { label: 'For', value: formatPeriod(vars.period) },
      { label: 'Amount', value: formatAmount(vars.amountPaise) },
      { label: 'Due by', value: formatDate(vars.dueOn) },
    ]),
    action('Pay now', PATHS.dues),
    note(
      'You can also pay at the society office. Either way a receipt is issued and kept in the app.',
    ),
  ];
}

export const subject = (vars: InvoiceRaisedVars): string =>
  `Maintenance for ${formatPeriod(vars.period)}`;

export const text = (vars: InvoiceRaisedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: InvoiceRaisedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: InvoiceRaisedVars): Record<string, string> => ({
  name: vars.recipientName,
  unit: vars.home,
  period: formatPeriod(vars.period),
  amount: formatAmount(vars.amountPaise),
  dueDate: formatDate(vars.dueOn),
});

export function decode(payload: unknown): InvoiceRaisedVars {
  const raw = asObject(payload);
  return {
    recipientName: str(raw, 'recipientName', 120),
    home: str(raw, 'home', 120),
    invoiceId: int(raw, 'invoiceId'),
    period: periodValue(raw, 'period'),
    amountPaise: money(raw, 'amountPaise'),
    dueOn: date(raw, 'dueOn'),
  };
}

export const template: MailTemplate<InvoiceRaisedVars> = {
  id: 'invoice.raised',
  decode,
  subject,
  text,
  html,
  variables,
};
