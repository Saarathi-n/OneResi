import { describe, expect, it } from 'vitest';
import {
  formatCalendarDate,
  formatCalendarDateShort,
  formatPeriod,
  istDayString,
} from './dates.js';

/**
 * A stored day renders as that day everywhere: the formatters pin UTC so a due date cannot move
 * with the reader's timezone. `formatPeriod` earns its place by the same logic — a billing
 * period is the month the money is for, and `2026-09` is a wire shape, not something a person
 * reads.
 */
describe('formatCalendarDate', () => {
  it('renders the stored UTC day', () => {
    expect(formatCalendarDate('2026-09-15T00:00:00.000Z')).toBe('15 Sep 2026');
    expect(formatCalendarDate('2026-09-15')).toBe('15 Sep 2026');
  });

  it('does not shift a day west of UTC', () => {
    expect(formatCalendarDate('2026-09-01T23:30:00.000Z')).toBe('1 Sep 2026');
  });

  it('falls back to the input when it does not parse', () => {
    expect(formatCalendarDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatCalendarDateShort', () => {
  it('renders the ledger order', () => {
    expect(formatCalendarDateShort('2026-09-15T00:00:00.000Z')).toBe('15/09/2026');
  });
});

describe('formatPeriod', () => {
  it('speaks the month, not the key', () => {
    expect(formatPeriod('2026-09')).toBe('September 2026');
    expect(formatPeriod('2025-01')).toBe('January 2025');
  });

  it('tolerates a full ISO instant and takes its month', () => {
    expect(formatPeriod('2026-09-01T00:00:00.000Z')).toBe('September 2026');
  });

  it('falls back to the raw string when it does not parse', () => {
    expect(formatPeriod('mismatch')).toBe('mismatch');
  });
});

describe('istDayString', () => {
  it('agrees with UTC while both calendars share a day', () => {
    expect(istDayString(new Date('2026-09-12T10:00:00.000Z'))).toBe('2026-09-12');
  });

  it('has already rolled over when UTC has five and a half hours of evening left', () => {
    expect(istDayString(new Date('2026-09-12T18:30:00.000Z'))).toBe('2026-09-13');
    expect(istDayString(new Date('2026-09-12T20:30:00.000Z'))).toBe('2026-09-13');
  });

  it('stays on the old day one minute before the IST rollover', () => {
    expect(istDayString(new Date('2026-09-12T18:29:59.000Z'))).toBe('2026-09-12');
  });

  it('reads the clock when no instant is given', () => {
    const now = new Date();
    const expected = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    expect(istDayString(now)).toBe(expected);
  });
});
