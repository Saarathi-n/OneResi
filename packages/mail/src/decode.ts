import { paise, type Paise } from '@oneresi/contracts';
import { PayloadError } from './errors.js';

/**
 * Reading `OutboxEvent.payload`.
 *
 * The payload is JSON written by a handler in an earlier transaction, possibly by an earlier version
 * of the code, so it is untrusted input and it is validated like any other. A bad payload is a
 * `PayloadError`, which the worker treats as permanent — five attempts at the same malformed row
 * cannot make it better, and a poison message that retries forever hides the queue behind it.
 */

function fail(key: string, expected: string, received: unknown): never {
  const shown =
    received === undefined
      ? 'nothing'
      : typeof received === 'string'
        ? `"${received.slice(0, 60)}"`
        : `${typeof received} ${JSON.stringify(received)?.slice(0, 60) ?? ''}`;
  throw new PayloadError(`"${key}" must be ${expected}, received ${shown}`);
}

export function asObject(value: unknown, what = 'payload'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(what, 'an object', value);
  }
  return value as Record<string, unknown>;
}

export function str(source: Record<string, unknown>, key: string, max = 4000): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') fail(key, 'a non-empty string', value);
  if (value.length > max) fail(key, `at most ${max} characters`, `${value.length} characters`);
  return value.trim();
}

export function optStr(
  source: Record<string, unknown>,
  key: string,
  max = 4000,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') return undefined;
  return str(source, key, max);
}

export function int(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(key, 'a whole number', value);
  return value;
}

/** Money crosses the wire as the integer paise it already is. Never a float, never a string (D-50). */
export function money(source: Record<string, unknown>, key: string): Paise {
  const value = int(source, key);
  try {
    return paise(value);
  } catch (cause) {
    throw new PayloadError(`"${key}" is not a usable amount in paise: ${value}`, { cause });
  }
}

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** ISO 8601. A calendar-only value arrives as `2026-09-15` and lands on UTC midnight, as stored. */
export function date(source: Record<string, unknown>, key: string): Date {
  const value = source[key];
  if (typeof value !== 'string' || !ISO_LIKE.test(value)) {
    fail(key, 'an ISO 8601 date such as 2026-09-15 or 2026-09-15T18:30:00.000Z', value);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(key, 'a date that exists', value);
  return parsed;
}

export function optDate(source: Record<string, unknown>, key: string): Date | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') return undefined;
  return date(source, key);
}

export function bool(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(key, 'true or false', value);
  return value;
}

/** An enumeration from `@oneresi/contracts`, so a template cannot be handed a value outside it. */
export function oneOf<const T extends readonly string[]>(
  source: Record<string, unknown>,
  key: string,
  values: T,
): T[number] {
  const value = source[key];
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    fail(key, `one of ${values.join(', ')}`, value);
  }
  return value as T[number];
}

/** A billing period, `YYYY-MM`, matching `Period` in `@oneresi/contracts`. */
export function period(source: Record<string, unknown>, key: string): string {
  const value = str(source, key, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail(key, 'a period such as 2026-09', value);
  return value;
}

/** `HH:MM`, 24-hour, zero padded — as stored, so lexical order is chronological. */
export function clockTime(source: Record<string, unknown>, key: string): string {
  const value = str(source, key, 5);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) fail(key, 'a time such as 18:30', value);
  return value;
}

/**
 * Deliberately narrow. Full address validation belongs to the Zod schema at the boundary that
 * accepted it; this is the last check before a message is addressed, and its job is to refuse a
 * header injection or an empty recipient rather than to be clever.
 */
export function emailAddress(source: Record<string, unknown>, key: string): string {
  const value = str(source, key, 254);
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(value)) {
    fail(key, 'a single email address', value);
  }
  return value.toLowerCase();
}
