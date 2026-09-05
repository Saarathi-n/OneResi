import type { OutboxEventType, Paise } from '@oneresi/contracts';

/**
 * Everything the mail package agrees with the rest of the system about, in one file.
 *
 * A template is a pure function of typed variables. It never reads a database, never formats an
 * origin of its own, and never receives a list of recipients — one message goes to one person, which
 * is the structural answer to a billing run that emailed every resident in the society for every
 * unit's invoice (D-29).
 */

/**
 * The thirteen mails, named for the event that causes them. `satisfies` ties them to the outbox
 * vocabulary, so a template id cannot drift from the event type a handler writes.
 *
 * Event types with no email template — `pass.created`, `visitor.arrived`, `complaint.raised`,
 * `complaint.reopened` — are in-app and push surfaces today. An EMAIL row for one of those is
 * abandoned with a reason rather than retried forever; see worker.ts.
 */
export const TEMPLATE_IDS = [
  'resident.registered',
  'resident.approved',
  'resident.declined',
  'password.reset_requested',
  'walkin.awaiting_decision',
  'walkin.decided',
  'complaint.updated',
  'invoice.raised',
  'invoice.overdue',
  'payment.received',
  'booking.requested',
  'booking.decided',
  'announcement.published',
] as const satisfies readonly OutboxEventType[];

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------- the content model

export interface DetailRow {
  readonly label: string;
  readonly value: string;
}

/**
 * One copy source, two renderings. A template describes what the message says; render.ts turns that
 * into the text part and the HTML part, so the two cannot drift and neither can be forgotten.
 *
 * `action` carries a **path**, never a URL. The only place a path becomes absolute is
 * `RenderContext.url`, which is built from `APP_ORIGIN` — six templates in the previous build
 * hardcoded `http://localhost:3000` and a deployed build emailed residents that address (D-22).
 */
export type Block =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'para'; readonly text: string }
  | { readonly kind: 'details'; readonly rows: readonly DetailRow[] }
  | { readonly kind: 'quote'; readonly text: string; readonly attribution?: string }
  | { readonly kind: 'bullets'; readonly items: readonly string[] }
  | { readonly kind: 'action'; readonly label: string; readonly path: string }
  | { readonly kind: 'note'; readonly text: string };

export interface RenderContext {
  /** Absolute, from `APP_ORIGIN`. Throws rather than returning a relative link. */
  url(path: string): string;
}

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /**
   * Display-ready values, recorded on the `MailMessage` row so a test can assert what the resident
   * actually read — `{ amount: '₹4,800.00', dueDate: '15 Sep 2026' }`. See docs/plan/05-testing.md.
   */
  readonly variables: Readonly<Record<string, string>>;
}

export interface MailTemplate<Vars> {
  readonly id: TemplateId;
  /** Wire JSON from `OutboxEvent.payload` to typed variables. Throws `PayloadError`. */
  decode(payload: unknown): Vars;
  subject(vars: Vars): string;
  text(vars: Vars, context: RenderContext): string;
  html(vars: Vars, context: RenderContext): string;
  variables(vars: Vars): Readonly<Record<string, string>>;
}

/** A template with its variable type erased, so the registry can hold all thirteen. */
export interface SealedTemplate {
  readonly id: TemplateId;
  render(payload: unknown, context: RenderContext): RenderedMail;
}

export function seal<Vars>(template: MailTemplate<Vars>): SealedTemplate {
  return {
    id: template.id,
    render: (payload, context) => {
      const vars = template.decode(payload);
      return {
        subject: template.subject(vars),
        text: template.text(vars, context),
        html: template.html(vars, context),
        variables: template.variables(vars),
      };
    },
  };
}

/**
 * The JSON form of a template's variables — what a handler writes into `OutboxEvent.payload`.
 * A `Date` crosses as an ISO 8601 string; `Paise` crosses as the integer it already is.
 */
export type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Paise ? number : T[K];
};

// ---------------------------------------------------------------- the envelope

/** Exactly one person. Not an array, and there is no cc or bcc anywhere in this package. */
export interface Recipient {
  readonly email: string;
  readonly name: string | undefined;
}

export interface MailEnvelope<Vars> {
  readonly to: { readonly email: string; readonly name?: string };
  readonly template: TemplateId;
  readonly vars: Vars;
}

/** A decoded envelope. `vars` stays unknown until the template decodes it. */
export interface MailJob {
  readonly to: Recipient;
  readonly template: TemplateId;
  readonly vars: unknown;
}

// ---------------------------------------------------------------- providers

export type MailDriver = 'console' | 'ses';

export interface SendRequest {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly template: TemplateId;
  /** Ties the delivery back to the request that caused it, for log correlation. */
  readonly correlationId: string;
}

export interface SendResult {
  readonly providerMessageId: string | null;
}

export interface MailProvider {
  readonly name: MailDriver;
  send(request: SendRequest): Promise<SendResult>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => {
    console.info(message);
  },
  warn: (message) => {
    console.warn(message);
  },
};
