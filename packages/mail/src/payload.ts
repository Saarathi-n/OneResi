import { OUTBOX_EVENT_TYPES, type OutboxEventType } from '@grihaone/contracts';
import { asObject, emailAddress, optStr } from './decode.js';
import { PayloadError } from './errors.js';
import { isTemplateId, type MailJob, type TemplateId } from './types.js';

/**
 * What a handler writes into `OutboxEvent.payload`, and how the worker reads it back.
 *
 * The domain's convention (the port contract at packages/domain/src/store.ts) is FLAT: the `name`
 * and `email` keys identify the ONE person the message is for, and every other key is a template
 * variable — `{ name, email, recipientName, home, period, amountPaise, dueOn }`. The recipient is
 * lifted out here; the rest is handed to the template's own decode as vars.
 *
 * An envelope form is also accepted, for a writer that wants the split spelled out:
 *
 * ```json
 * {
 *   "to":       { "email": "priya@grihaone.local", "name": "Priya Menon" },
 *   "template": "invoice.raised",
 *   "vars":     { "recipientName": "Priya Menon", "amountPaise": 480000, "dueOn": "2026-09-15" }
 * }
 * ```
 *
 * `to` is one person either way. Not an array, and there is no cc or bcc in this package at all — a
 * message for five people is five outbox rows, written by the handler for the five residents it
 * actually concerns. That is the structural fix for a billing run that emailed every resident in
 * the society for every unit's invoice, and a notice that awaited one send per resident inside the
 * request (D-29). The shape makes the defect unrepresentable rather than merely absent.
 *
 * `template` may be omitted when it is the same as the event type, which it usually is.
 */
export function decodeMailJob(eventType: string, payload: string): MailJob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    throw new PayloadError('The outbox payload is not valid JSON', { cause });
  }

  const raw = asObject(parsed);

  if (Array.isArray(raw['to'])) {
    throw new PayloadError(
      'One message goes to one person: "to" is a single recipient, not a list. Write one outbox ' +
        'row per recipient.',
    );
  }

  const requested = optStr(raw, 'template', 60) ?? eventType;
  if (!isTemplateId(requested)) {
    throw new PayloadError(
      `"${requested}" has no email template. Either the event is not an email event or the ` +
        'template has not been written yet.',
    );
  }

  // The recipient: the envelope's `to` if the row was written that way, otherwise the flat
  // `email`/`name` keys every domain service writes — the same rule decodePushJob keeps, so the
  // two channels can never disagree about who a row belongs to.
  if (raw['to'] === undefined) {
    const to = { email: emailAddress(raw, 'email'), name: optStr(raw, 'name', 120) };
    const vars: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'email' || key === 'name' || key === 'template') continue;
      vars[key] = value;
    }
    return { to, template: requested, vars };
  }

  const to = asObject(raw['to'], 'to');
  return {
    to: { email: emailAddress(to, 'email'), name: optStr(to, 'name', 120) },
    template: requested,
    vars: raw['vars'] === undefined ? {} : asObject(raw['vars'], 'vars'),
  };
}

/** For a handler that wants the compiler to check the envelope it is about to store. */
export function encodeMailJob(job: {
  readonly to: { readonly email: string; readonly name?: string };
  readonly template: TemplateId;
  readonly vars: Readonly<Record<string, unknown>>;
}): string {
  return JSON.stringify(job);
}

// ---------------------------------------------------------------- push

/** The outbox vocabulary, checked at the edge where a database string becomes an event type. */
function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * What the PUSH worker reads back out of a `channel = 'PUSH'` row.
 *
 * The payload is flat — the same shape the domain services write and the store's recipient
 * convention describes: the `name` and `email` keys identify the ONE person the message is for,
 * and every other key is a variable the push wording reads (`visitorName`, `validOn`, `purpose`).
 * The wording in packages/domain/src/notifications.ts reads those variables at the top level, so
 * a nested envelope here would render "undefined" on a lock screen. An envelope-style payload
 * written by the mail convention (`to.email`) is accepted for the recipient only; everything
 * else must be flat scalars, which is the port contract (`OutboxEventInput.payload`).
 */
export interface PushJob {
  /**
   * The event type, validated against the outbox vocabulary and narrowed to it — the string the
   * database stores is only a `string` until this says otherwise.
   */
  readonly type: OutboxEventType;
  /** The recipient — resolved to a userId by the worker, and the row's one addressee. */
  readonly email: string;
  /** The event's payload, verbatim minus any `to` envelope, as flat scalars. */
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export function decodePushJob(eventType: string, payload: string): PushJob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    throw new PayloadError('The outbox payload is not valid JSON', { cause });
  }

  const raw = asObject(parsed);

  if (!isOutboxEventType(eventType)) {
    throw new PayloadError(
      `"${eventType}" is not an outbox event type, so it has no push surface either.`,
    );
  }

  // The recipient: the mail envelope's `to.email` if this row was written that way, otherwise
  // the flat `email` key the domain services write. Either way, one person — not a list.
  let source: Record<string, unknown>;
  if (Array.isArray(raw['to'])) {
    throw new PayloadError(
      'One message goes to one person: "to" is a single recipient, not a list. Write one outbox ' +
        'row per recipient.',
    );
  } else if (raw['to'] === undefined) {
    source = raw;
  } else {
    source = asObject(raw['to'], 'to');
  }

  const job: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'to') continue;
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean' &&
      value !== null
    ) {
      throw new PayloadError(
        `"${key}" must be a flat value — a string, number, boolean or null — not a nested object. ` +
          'Outbox payloads are flat scalars so they survive JSON on either database.',
      );
    }
    job[key] = value;
  }

  return { type: eventType, email: emailAddress(source, 'email'), payload: job };
}
