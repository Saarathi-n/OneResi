import type { Paise } from '@oneresi/contracts';
import { action, details, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, clockTime, date, int, money, str } from '../decode.js';
import { formatDate, formatWindow, money as formatAmount } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * A resident wants a facility for an evening, and the committee has to say yes or no.
 *
 * The charge is here because the previous build displayed an hourly rate on the facility card and then
 * never used it in any calculation, so a booking cost nothing (D-72). It arrives worked out by the
 * domain from the rate and the length of the window — a template never multiplies money.
 */

export interface BookingRequestedVars {
  readonly bookingId: number;
  readonly facilityName: string;
  readonly residentName: string;
  readonly home: string;
  readonly bookingDate: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly amountPaise: Paise;
}

export type BookingRequestedPayload = Wire<BookingRequestedVars>;

function compose(vars: BookingRequestedVars): Block[] {
  return [
    heading(`${vars.facilityName} — booking request`),
    para(
      `${vars.residentName} of ${vars.home} has asked for the ${vars.facilityName} on ` +
        `${formatDate(vars.bookingDate)}.`,
    ),
    details([
      { label: 'Facility', value: vars.facilityName },
      { label: 'Date', value: formatDate(vars.bookingDate) },
      { label: 'Time', value: formatWindow(vars.startTime, vars.endTime) },
      { label: 'Charge', value: formatAmount(vars.amountPaise) },
      { label: 'Requested by', value: vars.residentName },
      { label: 'Home', value: vars.home },
    ]),
    action('Confirm or decline', PATHS.bookingReview),
    note(
      'The slot is held while this is pending, so nobody else can take it. Declining releases it ' +
        'immediately.',
    ),
  ];
}

export const subject = (vars: BookingRequestedVars): string =>
  `Booking request — ${vars.facilityName}, ${formatDate(vars.bookingDate)}`;

export const text = (vars: BookingRequestedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: BookingRequestedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: BookingRequestedVars): Record<string, string> => ({
  facility: vars.facilityName,
  requestedBy: vars.residentName,
  unit: vars.home,
  date: formatDate(vars.bookingDate),
  time: formatWindow(vars.startTime, vars.endTime),
  amount: formatAmount(vars.amountPaise),
});

export function decode(payload: unknown): BookingRequestedVars {
  const raw = asObject(payload);
  return {
    bookingId: int(raw, 'bookingId'),
    facilityName: str(raw, 'facilityName', 80),
    residentName: str(raw, 'residentName', 120),
    home: str(raw, 'home', 120),
    bookingDate: date(raw, 'bookingDate'),
    startTime: clockTime(raw, 'startTime'),
    endTime: clockTime(raw, 'endTime'),
    amountPaise: money(raw, 'amountPaise'),
  };
}

export const template: MailTemplate<BookingRequestedVars> = {
  id: 'booking.requested',
  decode,
  subject,
  text,
  html,
  variables,
};
