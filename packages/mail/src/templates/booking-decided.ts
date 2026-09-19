import { BOOKING_STATUS, type Paise } from '@grihaone/contracts';
import { action, details, note, para, quote, renderHtml, renderText } from '../document.js';
import { asObject, clockTime, date, int, money, oneOf, optStr, str } from '../decode.js';
import { formatDate, formatWindow, money as formatAmount } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The committee's answer on a booking. The status renders through the label map, never as the raw
 * value (D-55), and the decision is attributed — `decidedById` and `decidedAt` are columns the
 * previous build left null (D-21 for the gate, the same omission here).
 */

/** The two outcomes a committee decision can produce. A subset of `BOOKING_STATUSES`. */
export const DECIDED_STATUSES = ['CONFIRMED', 'REJECTED'] as const;

export interface BookingDecidedVars {
  readonly recipientName: string;
  readonly bookingId: number;
  readonly facilityName: string;
  readonly bookingDate: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: (typeof DECIDED_STATUSES)[number];
  readonly amountPaise: Paise;
  readonly decidedByName: string;
  readonly reason?: string;
}

export type BookingDecidedPayload = Wire<BookingDecidedVars>;

function compose(vars: BookingDecidedVars): Block[] {
  const confirmed = vars.status === 'CONFIRMED';

  const blocks: Block[] = [
    para(`Hello ${vars.recipientName},`),
    para(
      confirmed
        ? `Your booking for the ${vars.facilityName} is confirmed.`
        : `The committee could not confirm your booking for the ${vars.facilityName}.`,
    ),
    details([
      { label: 'Facility', value: vars.facilityName },
      { label: 'Date', value: formatDate(vars.bookingDate) },
      { label: 'Time', value: formatWindow(vars.startTime, vars.endTime) },
      { label: 'Charge', value: formatAmount(vars.amountPaise) },
      { label: 'Status', value: BOOKING_STATUS[vars.status].label },
      { label: 'Decided by', value: vars.decidedByName },
    ]),
  ];

  if (vars.reason !== undefined) {
    blocks.push(quote(vars.reason, vars.decidedByName));
  }

  blocks.push(action('See the booking', PATHS.booking));

  if (confirmed) {
    blocks.push(
      note(
        'If your plans change, cancel it in the app and the slot goes straight back to everyone ' +
          'else rather than sitting unused.',
      ),
    );
  } else {
    blocks.push(note('The slot is free again, so another date or time is worth trying.'));
  }

  return blocks;
}

export const subject = (vars: BookingDecidedVars): string =>
  `${vars.facilityName} on ${formatDate(vars.bookingDate)} — ${BOOKING_STATUS[vars.status].label}`;

export const text = (vars: BookingDecidedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: BookingDecidedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: BookingDecidedVars): Record<string, string> => ({
  name: vars.recipientName,
  facility: vars.facilityName,
  date: formatDate(vars.bookingDate),
  time: formatWindow(vars.startTime, vars.endTime),
  amount: formatAmount(vars.amountPaise),
  status: BOOKING_STATUS[vars.status].label,
  decidedBy: vars.decidedByName,
  ...(vars.reason === undefined ? {} : { reason: vars.reason }),
});

export function decode(payload: unknown): BookingDecidedVars {
  const raw = asObject(payload);
  const reason = optStr(raw, 'reason', 280);
  return {
    recipientName: str(raw, 'recipientName', 120),
    bookingId: int(raw, 'bookingId'),
    facilityName: str(raw, 'facilityName', 80),
    bookingDate: date(raw, 'bookingDate'),
    startTime: clockTime(raw, 'startTime'),
    endTime: clockTime(raw, 'endTime'),
    status: oneOf(raw, 'status', DECIDED_STATUSES),
    amountPaise: money(raw, 'amountPaise'),
    decidedByName: str(raw, 'decidedByName', 120),
    ...(reason === undefined ? {} : { reason }),
  };
}

export const template: MailTemplate<BookingDecidedVars> = {
  id: 'booking.decided',
  decode,
  subject,
  text,
  html,
  variables,
};
