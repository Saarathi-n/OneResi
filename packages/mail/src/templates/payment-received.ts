import { PAYMENT_METHOD, PAYMENT_METHODS, type Paise } from '@grihaone/contracts';
import { action, details, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, date, money, oneOf, period as periodValue, str } from '../decode.js';
import {
  formatDateTime,
  formatPeriod,
  money as formatAmount,
  moneyWords,
} from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The receipt.
 *
 * Every figure here comes from the persisted payment row. The previous build synthesised a receipt in
 * the browser when the payments array was empty — inventing the receipt number, the reference and
 * today's date as the payment date (D-26) — and the amount reached the resident having been a Decimal,
 * a string and a float on the way (D-50). Nothing is derived here: the amount is formatted, the words
 * are the same amount spelled out, and the receipt number is the one in the ledger.
 *
 * The method is a real method. That no gateway is involved is an engineering decision recorded in the
 * decision log; it is not a message for the resident (D-54).
 */

export interface PaymentReceivedVars {
  readonly recipientName: string;
  readonly home: string;
  readonly period: string;
  readonly receiptNo: string;
  readonly amountPaise: Paise;
  readonly method: (typeof PAYMENT_METHODS)[number];
  readonly paidAt: Date;
  /** The payment reference, unique per payment, quotable at the office. */
  readonly reference: string;
}

export type PaymentReceivedPayload = Wire<PaymentReceivedVars>;

function compose(vars: PaymentReceivedVars): Block[] {
  return [
    heading('Payment received'),
    para(`Hello ${vars.recipientName},`),
    para(
      `We have your maintenance payment for ${formatPeriod(vars.period)}. This message is your ` +
        'receipt; the full one is in the app whenever you need it.',
    ),
    details([
      { label: 'Receipt number', value: vars.receiptNo },
      { label: 'Home', value: vars.home },
      { label: 'For', value: formatPeriod(vars.period) },
      { label: 'Amount', value: formatAmount(vars.amountPaise) },
      { label: 'In words', value: moneyWords(vars.amountPaise) },
      { label: 'Paid by', value: PAYMENT_METHOD[vars.method].label },
      { label: 'Paid on', value: formatDateTime(vars.paidAt) },
      { label: 'Reference', value: vars.reference },
    ]),
    action('Open the receipt', PATHS.receipt(vars.receiptNo)),
    note(
      'Quote the receipt number if you ever need the committee to look this payment up. It stays ' +
        'available even after the year closes.',
    ),
  ];
}

export const subject = (vars: PaymentReceivedVars): string =>
  `Receipt ${vars.receiptNo} — maintenance for ${formatPeriod(vars.period)}`;

export const text = (vars: PaymentReceivedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: PaymentReceivedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: PaymentReceivedVars): Record<string, string> => ({
  name: vars.recipientName,
  unit: vars.home,
  period: formatPeriod(vars.period),
  receiptNo: vars.receiptNo,
  amount: formatAmount(vars.amountPaise),
  amountInWords: moneyWords(vars.amountPaise),
  method: PAYMENT_METHOD[vars.method].label,
  paidOn: formatDateTime(vars.paidAt),
  reference: vars.reference,
});

export function decode(payload: unknown): PaymentReceivedVars {
  const raw = asObject(payload);
  return {
    recipientName: str(raw, 'recipientName', 120),
    home: str(raw, 'home', 120),
    period: periodValue(raw, 'period'),
    receiptNo: str(raw, 'receiptNo', 40),
    amountPaise: money(raw, 'amountPaise'),
    method: oneOf(raw, 'method', PAYMENT_METHODS),
    paidAt: date(raw, 'paidAt'),
    reference: str(raw, 'reference', 40),
  };
}

export const template: MailTemplate<PaymentReceivedVars> = {
  id: 'payment.received',
  decode,
  subject,
  text,
  html,
  variables,
};
