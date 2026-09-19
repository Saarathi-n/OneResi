import { getDb, type Db } from '@grihaone/db';
import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { MailAssertionError, MailDeliveryError } from './errors.js';
import type { SesClientLike } from './providers/ses.js';
import {
  consoleLogger,
  type Logger,
  type MailDriver,
  type MailProvider,
  type TemplateId,
} from './types.js';

/**
 * Asserting on mail.
 *
 * Mail history is a database table specifically so this file can exist. The previous build appended to
 * a JSON file inside the container (D-31), so there was nothing a test could look at, and the suite
 * asserted nothing about email at all (D-75). Everything here reads `mail_message` and `outbox_event`.
 *
 * No test framework is imported. A failed expectation is a `MailAssertionError` carrying its own
 * diagnostics — every runner reports a thrown error, and the diagnostics are the point: a matcher that
 * says only "expected 1, got 0" makes you go and query the table by hand.
 *
 * One deliberate constraint: no case-insensitive filters. Prisma's `mode: 'insensitive'` is
 * PostgreSQL-only and the whole integration suite runs on both engines, so addresses are compared
 * exactly — `deliver()` stores them already lower cased.
 */

let configured: Db | undefined;

/** Call once per test file, with the isolated database that file was given. */
export function setMailTestDatabase(db: Db): void {
  configured = db;
}

export function resetMailTesting(): void {
  configured = undefined;
}

export interface MailRow {
  readonly id: number;
  readonly outboxEventId: number | null;
  readonly provider: string;
  readonly providerMessageId: string | null;
  readonly template: string;
  readonly toAddress: string;
  readonly fromAddress: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly status: string;
  readonly error: string | null;
  readonly sentAt: Date | null;
  readonly deliveryState: string | null;
  readonly createdAt: Date;
}

interface StoredMail extends Omit<MailRow, 'variables'> {
  readonly variables: string;
}

function withParsedVariables(row: StoredMail): MailRow {
  let variables: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.variables);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      variables = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : String(value),
        ]),
      );
    }
  } catch {
    variables = {};
  }
  return { ...row, variables };
}

function describe(row: MailRow): string {
  return (
    `#${row.id} to ${row.toAddress} · ${row.template} · "${row.subject}" · ${row.status}` +
    `${row.error === null ? '' : ` · ${row.error}`}`
  );
}

export class MailExpectation {
  readonly #given: Db | undefined;
  #to: string | undefined;
  #template: TemplateId | undefined;
  #subject: RegExp | string | undefined;
  #vars: Readonly<Record<string, string | number>> | undefined;
  #provider: MailDriver | undefined;

  constructor(db?: Db) {
    this.#given = db;
  }

  /** The intended recipient, and only them. Matched exactly, lower cased. */
  to(email: string): this {
    this.#to = email.trim().toLowerCase();
    return this;
  }

  withTemplate(template: TemplateId): this {
    this.#template = template;
    return this;
  }

  /** A pattern, or a substring if you pass a string. */
  withSubject(subject: RegExp | string): this {
    this.#subject = subject;
    return this;
  }

  /** A subset of the rendered variables, compared as the strings a resident read. */
  withVars(vars: Readonly<Record<string, string | number>>): this {
    this.#vars = vars;
    return this;
  }

  /** Which provider actually ran — the fact the previous build could not have recorded (D-30). */
  withProvider(provider: MailDriver): this {
    this.#provider = provider;
    return this;
  }

  async #db(): Promise<Db> {
    return this.#given ?? configured ?? (await getDb());
  }

  #filters(): string[] {
    const parts: string[] = [];
    if (this.#to !== undefined) parts.push(`to ${this.#to}`);
    if (this.#template !== undefined) parts.push(`template ${this.#template}`);
    if (this.#subject !== undefined) parts.push(`subject matching ${String(this.#subject)}`);
    if (this.#provider !== undefined) parts.push(`provider ${this.#provider}`);
    if (this.#vars !== undefined) parts.push(`variables ${JSON.stringify(this.#vars)}`);
    return parts;
  }

  #mismatch(row: MailRow): string | null {
    if (this.#subject !== undefined) {
      const matched =
        typeof this.#subject === 'string'
          ? row.subject.includes(this.#subject)
          : this.#subject.test(row.subject);
      if (!matched) return `subject was "${row.subject}"`;
    }
    if (this.#provider !== undefined && row.provider !== this.#provider) {
      return `provider was "${row.provider}"`;
    }
    if (this.#vars !== undefined) {
      for (const [key, expected] of Object.entries(this.#vars)) {
        const actual = row.variables[key];
        if (actual !== String(expected)) {
          return `variable "${key}" was ${actual === undefined ? 'absent' : `"${actual}"`}, ` +
            `expected "${String(expected)}"`;
        }
      }
    }
    return null;
  }

  /** Everything matching, oldest first. The escape hatch when an assertion is not the right shape. */
  async rows(): Promise<readonly MailRow[]> {
    const db = await this.#db();
    const stored = await db.mailMessage.findMany({
      where: {
        ...(this.#to === undefined ? {} : { toAddress: this.#to }),
        ...(this.#template === undefined ? {} : { template: this.#template }),
      },
      orderBy: { id: 'asc' },
    });

    return stored
      .map((row) => withParsedVariables(row))
      .filter((row) => this.#mismatch(row) === null);
  }

  /** Failure messages carry what *was* sent, so a miss does not send you to a SQL prompt. */
  async #diagnose(): Promise<string> {
    const db = await this.#db();
    const all = (await db.mailMessage.findMany({ orderBy: { id: 'asc' }, take: 12 })).map((row) =>
      withParsedVariables(row),
    );

    if (all.length === 0) {
      const pending = await db.outboxEvent.count({ where: { channel: 'EMAIL', status: 'PENDING' } });
      return pending > 0
        ? `Nothing has been sent, but ${pending} email outbox row(s) are waiting. The worker has to ` +
            'run before a message exists: await drainOutbox({ db }).'
        : 'Nothing has been sent, and there are no email outbox rows either, so the use case never ' +
            'wrote one.';
    }

    const lines = all.map((row) => {
      const why = this.#mismatch(row);
      return `  ${describe(row)}${why === null ? '' : ` — ${why}`}`;
    });
    return `What is in the table:\n${lines.join('\n')}`;
  }

  #wanted(): string {
    const filters = this.#filters();
    return filters.length === 0 ? '' : ` with ${filters.join(', ')}`;
  }

  /**
   * Exactly one, and it went. One per recipient is the assertion that matters: posting one notice
   * emailed every resident in the society for every unit's invoice in the previous build (D-29).
   */
  async toHaveBeenSentOnce(): Promise<MailRow> {
    const found = await this.rows();
    if (found.length !== 1) {
      throw new MailAssertionError(
        `Expected exactly one message${this.#wanted()}, found ${found.length}.\n` +
          `${await this.#diagnose()}`,
      );
    }
    const row = found[0];
    if (row === undefined) throw new MailAssertionError('Unreachable: one row, none read');
    if (row.status !== 'SENT') {
      throw new MailAssertionError(
        `The message exists but has not gone out: ${describe(row)}.\n` +
          'A message is only sent once the worker has delivered it.',
      );
    }
    return row;
  }

  async toHaveBeenSentTimes(times: number): Promise<readonly MailRow[]> {
    const found = await this.rows();
    if (found.length !== times) {
      throw new MailAssertionError(
        `Expected ${times} message(s)${this.#wanted()}, found ${found.length}.\n` +
          `${await this.#diagnose()}`,
      );
    }
    const unsent = found.filter((row) => row.status !== 'SENT');
    if (unsent.length > 0) {
      throw new MailAssertionError(
        `${unsent.length} of them have not gone out:\n${unsent.map((row) => `  ${describe(row)}`).join('\n')}`,
      );
    }
    return found;
  }

  /** Nobody outside the intended recipients got anything. The other half of "one per recipient". */
  async toHaveNeverBeenSent(): Promise<void> {
    const found = await this.rows();
    if (found.length > 0) {
      throw new MailAssertionError(
        `Expected no message${this.#wanted()}, found ${found.length}:\n` +
          `${found.map((row) => `  ${describe(row)}`).join('\n')}`,
      );
    }
  }

  /**
   * Nothing is stuck. Every email outbox row is `SENT` and every mail row with it.
   *
   * Global on purpose. Narrowing it with filters would let a stuck row elsewhere pass silently, which
   * is the fail-open shape this codebase exists to remove (D-14).
   */
  async toHaveNoUnsent(): Promise<void> {
    if (this.#filters().length > 0) {
      throw new MailAssertionError(
        'toHaveNoUnsent() is a whole-table assertion; call expectMail().toHaveNoUnsent() with no ' +
          'filters, and use toHaveBeenSentOnce() for one message.',
      );
    }

    const db = await this.#db();
    const problems: string[] = [];

    const stuck = await db.outboxEvent.findMany({
      where: { channel: 'EMAIL', status: { not: 'SENT' } },
      orderBy: { id: 'asc' },
      select: { id: true, type: true, status: true, attempts: true, lastError: true },
    });
    for (const row of stuck) {
      problems.push(
        `  outbox #${row.id} ${row.type} · ${row.status} · ${row.attempts} attempt(s)` +
          `${row.lastError === null ? '' : ` · ${row.lastError}`}`,
      );
    }

    const unsent = await db.mailMessage.findMany({
      where: { status: { not: 'SENT' } },
      orderBy: { id: 'asc' },
    });
    for (const row of unsent) problems.push(`  ${describe(withParsedVariables(row))}`);

    if (problems.length > 0) {
      throw new MailAssertionError(`Mail is still waiting or has failed:\n${problems.join('\n')}`);
    }
  }
}

/**
 * ```ts
 * await expectMail()
 *   .to('priya@grihaone.local')
 *   .withTemplate('invoice.raised')
 *   .withSubject(/Maintenance for September/)
 *   .withVars({ amount: '₹4,800.00', dueDate: '15 Sep 2026' })
 *   .toHaveBeenSentOnce();
 *
 * await expectMail().toHaveNoUnsent();
 * ```
 *
 * The database comes from the argument, then from `setMailTestDatabase`, then from the process.
 */
export function expectMail(db?: Db): MailExpectation {
  return new MailExpectation(db);
}

// ---------------------------------------------------------------- doubles

export interface RecordingSesClient {
  readonly client: SesClientLike;
  /** Exactly what was handed to SES, in order: source identity, destination, configuration set, body. */
  readonly sent: readonly SendEmailCommandInput[];
}

/**
 * The second tier of the mail suite: a transport that records the real `SendEmailCommand` input, so the
 * region, the sending identity, the configuration set name and the destination are asserted without
 * spending anything. This is the check that would have caught a "SES provider" which only wrote a
 * console line and never had an AWS SDK to call (D-30).
 */
export function recordingSesClient(
  options: { readonly messageIdPrefix?: string; readonly failWith?: Error } = {},
): RecordingSesClient {
  const sent: SendEmailCommandInput[] = [];

  return {
    sent,
    client: {
      send: (command) => {
        sent.push(command.input);
        if (options.failWith !== undefined) return Promise.reject(options.failWith);
        return Promise.resolve({
          MessageId: `${options.messageIdPrefix ?? 'ses-test'}-${sent.length}`,
        });
      },
    },
  };
}

/**
 * A provider that always fails, for the assertion that matters most: when the provider throws, the
 * calling use case still succeeds and the outbox row is marked with the error. That is the alternative
 * flow the outbox exists for, and in the previous build it was a try/catch around an inline send, which
 * is why failures were invisible (D-29).
 */
export function failingProvider(
  options: {
    readonly message?: string;
    readonly permanent?: boolean;
    readonly name?: MailDriver;
    readonly providerCode?: string;
  } = {},
): MailProvider {
  return {
    name: options.name ?? 'ses',
    send: () =>
      Promise.reject(
        new MailDeliveryError(options.message ?? 'The provider is unavailable', {
          permanent: options.permanent ?? false,
          ...(options.providerCode === undefined ? {} : { providerCode: options.providerCode }),
        }),
      ),
  };
}

export interface CollectingLogger {
  readonly logger: Logger;
  readonly lines: readonly string[];
}

/** Keeps the worker quiet in a test run, and readable when one fails. */
export function collectingLogger(options: { readonly echo?: boolean } = {}): CollectingLogger {
  const lines: string[] = [];
  const capture = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`);
    if (options.echo === true) {
      if (level === 'warn') consoleLogger.warn(message);
      else consoleLogger.info(message);
    }
  };

  return { lines, logger: { info: capture('info'), warn: capture('warn') } };
}

export { MailAssertionError } from './errors.js';


