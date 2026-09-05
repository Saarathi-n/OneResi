import { asObject, emailAddress, optStr } from './decode.js';
import { PayloadError } from './errors.js';
import { isTemplateId, type MailJob, type TemplateId } from './types.js';

/**
 * What a handler writes into `OutboxEvent.payload`, and how the worker reads it back.
 *
 * ```json
 * {
 *   "to":       { "email": "priya@oneresi.local", "name": "Priya Menon" },
 *   "template": "invoice.raised",
 *   "vars":     { "recipientName": "Priya Menon", "amountPaise": 480000, "dueOn": "2026-09-15" }
 * }
 * ```
 *
 * `to` is one person. Not an array, and there is no cc or bcc in this package at all — a message for
 * five people is five outbox rows, written by the handler for the five residents it actually concerns.
 * That is the structural fix for a billing run that emailed every resident in the society for every
 * unit's invoice, and a notice that awaited one send per resident inside the request (D-29). The shape
 * makes the defect unrepresentable rather than merely absent.
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
  const to = asObject(raw['to'], 'to');

  const requested = optStr(raw, 'template', 60) ?? eventType;
  if (!isTemplateId(requested)) {
    throw new PayloadError(
      `"${requested}" has no email template. Either the event is not an email event or the ` +
        'template has not been written yet.',
    );
  }

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
