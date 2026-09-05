import { formatMoney, moneyInWords, type Paise } from '@oneresi/contracts';
import { RenderError } from './errors.js';

/**
 * How a message renders a value. Deliberately not `Intl.DateTimeFormat`: these strings are asserted
 * by the mail suite, and a locale data change should not fail a test or move a date on a receipt.
 *
 * The society is in India and IST has no daylight saving, so one fixed offset is exact. Calendar-only
 * values — a due date, a booking date — are stored at UTC midnight, and shifting them forward by the
 * offset lands on the same calendar day.
 */

const IST_OFFSET_MINUTES = 330;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function monthName(index: number): string {
  const name = MONTHS[index];
  if (name === undefined) throw new RenderError(`No such month: ${index}`);
  return name;
}

interface Parts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function istParts(value: Date): Parts {
  const time = value.getTime();
  if (Number.isNaN(time)) throw new RenderError('A message was given an invalid date');
  const shifted = new Date(time + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function clock(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** `15 Sep 2026`. */
export function formatDate(value: Date): string {
  const { day, month, year } = istParts(value);
  return `${String(day).padStart(2, '0')} ${monthName(month).slice(0, 3)} ${year}`;
}

/** `15 September 2026`, for a line that has room. */
export function formatDateLong(value: Date): string {
  const { day, month, year } = istParts(value);
  return `${day} ${monthName(month)} ${year}`;
}

/** `15 Sep 2026, 6:40 pm`. */
export function formatDateTime(value: Date): string {
  const { hour, minute } = istParts(value);
  return `${formatDate(value)}, ${clock(hour, minute)}`;
}

/** `6:40 pm`. */
export function formatTime(value: Date): string {
  const { hour, minute } = istParts(value);
  return clock(hour, minute);
}

/** `18:30` as stored, to `6:30 pm` as read. */
export function formatClockTime(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) throw new RenderError(`Not a stored time: "${value}"`);
  return clock(Number(match[1]), Number(match[2]));
}

/** `6:00 pm to 8:00 pm`. */
export function formatWindow(startTime: string, endTime: string): string {
  return `${formatClockTime(startTime)} to ${formatClockTime(endTime)}`;
}

/** `2026-09` to `September 2026`. */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (match === null) throw new RenderError(`Not a billing period: "${period}"`);
  return `${monthName(Number(match[2]) - 1)} ${match[1]}`;
}

/**
 * `₹4,800.00`. The one place a fraction exists is `formatMoney`; a template never does arithmetic on
 * an amount, because the previous build had the same figure as a Decimal, a string and a float in
 * one flow (D-50).
 */
export function money(value: Paise): string {
  return formatMoney(value);
}

/** `Four thousand eight hundred rupees only` — the line a receipt needs. */
export function moneyWords(value: Paise): string {
  return moneyInWords(value);
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
