/**
 * Date and label helpers for the parts a shared component does not already cover. Everything here
 * renders for a person; nothing here touches money (that is `C.formatMoney` / the `Money`
 * component) and nothing here renders a raw enumeration value.
 */

const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });
const MONTH_NAME = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });

/** "15 Sep" — a due date, a booking date, a pass date. */
export function formatDay(value: string | Date): string {
  return DAY_MONTH.format(new Date(value));
}

/** "15 Sep 2026" — when the year is not obviously this one. */
export function formatDayYear(value: string | Date): string {
  return DAY_MONTH_YEAR.format(new Date(value));
}

/** "Monday" — the day a facility booking or a pass falls on. */
export function formatWeekday(value: string | Date): string {
  return WEEKDAY.format(new Date(value));
}

/** A `YYYY-MM` billing period as "September 2026". */
export function formatPeriod(period: string): string {
  const parsed = new Date(`${period}-01T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? period : MONTH_NAME.format(parsed);
}

/** Today as `YYYY-MM-DD`, in the device's timezone — a pass defaults to today. */
export function todayInput(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Tomorrow as `YYYY-MM-DD` — one tap away on the pass form. */
export function tomorrowInput(): string {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "20 Sep" style due framing with urgency, for the dashboard's next action. */
export function duePhrase(dueOn: string): string {
  const due = new Date(dueOn);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `was due ${formatDay(due)}`;
  if (days === 0) return 'is due today';
  if (days === 1) return 'is due tomorrow';
  return `is due ${formatDay(due)}`;
}

/** "18:30" as "6:30 pm" for slot pickers and bookings. */
export function formatClockTime(value: string): string {
  const [hourRaw, minute] = value.split(':');
  const hour = Number(hourRaw);
  if (Number.isNaN(hour) || minute === undefined) return value;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute} ${suffix}`;
}

/**
 * Why a slot cannot be taken, in words. The reason crosses the wire as a code; the label is what
 * a person reads.
 */
export function slotReasonLabel(reason: 'HELD' | 'OUTSIDE_HOURS' | 'PAST'): string {
  if (reason === 'HELD') return 'Already booked';
  if (reason === 'OUTSIDE_HOURS') return 'Outside opening hours';
  return 'Already past';
}

/** Groups items by calendar day, newest first, for feeds that read as a diary. */
export function groupByDay<T>(
  items: readonly T[],
  dateOf: (item: T) => string,
): readonly { day: string; items: readonly T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const date = new Date(dateOf(item));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }
  return Array.from(groups.entries()).map(([day, dayItems]) => ({ day, items: dayItems }));
}
