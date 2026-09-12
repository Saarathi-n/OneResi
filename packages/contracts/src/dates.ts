/**
 * Calendar dates, formatted where everyone renders them the same way.
 *
 * The database stores a calendar day as its UTC midnight (`2026-09-15T00:00:00.000Z`). A date
 * rendered through `new Date(iso).toLocaleDateString()` is first converted to the reader's
 * timezone, so the same stored day reads as the 14th to anybody west of UTC — a due date that
 * moves with the reader is a lie about when the money is owed. The formatters here pin the
 * timezone to UTC, so a stored day renders as that day, everywhere, exactly as it was written.
 */

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const LONG_MONTHS = [
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

/**
 * One stored calendar day as `15 Sep 2026` — `day month year`, the order the app reads dates in.
 *
 * @param iso An ISO 8601 string whose calendar day is the day to render. The time-of-day and
 *   offset, if present, are ignored: the day is taken from the string, not from any timezone's
 *   reading of the instant.
 */
export function formatCalendarDate(iso: string): string {
  const day = iso.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  const d = parsed.getUTCDate();
  const m = SHORT_MONTHS[parsed.getUTCMonth()];
  const y = parsed.getUTCFullYear();
  return `${d} ${m} ${y}`;
}

/** The same day as `15/09/2026`, the order a ledger column usually wants. */
export function formatCalendarDateShort(iso: string): string {
  const day = iso.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  const d = String(parsed.getUTCDate()).padStart(2, '0');
  const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const y = parsed.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/** A `YYYY-MM` billing period as `September 2026`, pinned to UTC like every date here. A period
 * is the month the money is for, not a database key — `2026-09` is for the wire, never for a
 * person. Falls back to the raw string when it does not parse. */
export function formatPeriod(period: string): string {
  const parsed = new Date(`${period.slice(0, 7)}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return period;
  return `${LONG_MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

