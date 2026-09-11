/**
 * Calendar dates, formatted where everyone renders them the same way.
 *
 * The database stores a calendar day as its UTC midnight (`2026-09-15T00:00:00.000Z`). A date
 * rendered through `new Date(iso).toLocaleDateString()` is first converted to the reader's
 * timezone, so the same stored day reads as the 14th to anybody west of UTC — a due date that
 * moves with the reader is a lie about when the money is owed. The formatters here pin the
 * timezone to UTC, so a stored day renders as that day, everywhere, exactly as it was written.
 */

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
  return parsed.toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The same day as `15/09/2026`, the order a ledger column usually wants. */
export function formatCalendarDateShort(iso: string): string {
  const day = iso.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
