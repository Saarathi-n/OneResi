import type { Db } from '@grihaone/db';
import { describeError, isPermanent } from '../errors.js';
import { mailDriver, mailFrom } from '../env.js';
import { createConsoleProvider } from './console.js';
import type {
  MailDriver,
  MailProvider,
  Recipient,
  RenderedMail,
  TemplateId,
} from '../types.js';

/**
 * Choosing a provider, and the one path every message takes on its way out.
 *
 * `deliver()` writes the `MailMessage` row, calls the provider, then updates the row with what
 * happened. Both providers go through it, so mail history is a database table no matter which one ran,
 * and the row records *which* one did — that is the fact the previous build's "SES provider" could not
 * have produced, because it only wrote a console line (D-30, D-31).
 *
 * It never throws. Every outcome, including a database failure, comes back as a value, because the
 * caller is the outbox worker and the whole reason the outbox exists is that a monthly invoice run
 * must not fail because mail is down (D-29).
 */

/**
 * Memoised per driver: an SES client holds sockets, so constructing one per message would leak them.
 *
 * The cache holds the in-flight *promise*, not the resolved provider — the same shape
 * `packages/db`'s `client.ts` uses for its connection — and it is published synchronously, before
 * any `await`, so two callers that arrive while the SES module is still loading share one
 * construction instead of racing to build two clients. A construction that fails deletes its own
 * entry rather than leaving a rejection cached, so a fixed environment is picked up on the next
 * call.
 *
 * The SES module is loaded on demand — the same shape `packages/db` uses for its two Prisma clients —
 * so a local run in console mode never pulls the AWS SDK into the process at all, and the AWS build
 * loads exactly one provider. Callers that want a specific provider synchronously can construct it
 * themselves: `createConsoleProvider()`, or `createSesProvider()` from `@grihaone/mail/providers/ses`.
 */
const cache: Partial<Record<MailDriver, Promise<MailProvider>>> = {};

function construct(chosen: MailDriver): Promise<MailProvider> {
  return (async (): Promise<MailProvider> => {
    if (chosen === 'ses') {
      const { createSesProvider } = await import('./ses.js');
      return createSesProvider();
    }
    return createConsoleProvider();
  })();
}

export async function selectProvider(driver?: MailDriver): Promise<MailProvider> {
  const chosen = driver ?? mailDriver();

  // Lookup and publish are both synchronous — no `await` between them, which is what makes the
  // publish safe against a concurrent caller reading the same empty slot.
  let opened = cache[chosen];
  if (opened === undefined) {
    opened = construct(chosen);
    cache[chosen] = opened;
  }

  try {
    return await opened;
  } catch (cause) {
    if (cache[chosen] === opened) delete cache[chosen];
    throw cause;
  }
}

/** For tests that switch drivers inside one process. */
export function resetProviderCache(): void {
  delete cache.ses;
  delete cache.console;
}

export interface DeliverInput {
  readonly db: Db;
  readonly to: Recipient;
  readonly template: TemplateId;
  readonly rendered: RenderedMail;
  readonly correlationId: string;
  /** Ties the row to the outbox event, one to one, so a retry updates rather than duplicates. */
  readonly outboxEventId?: number | undefined;
  readonly provider?: MailProvider | undefined;
  readonly from?: string | undefined;
  readonly now?: Date | undefined;
}

export type DeliverOutcome =
  | {
      readonly ok: true;
      readonly provider: MailDriver;
      readonly mailMessageId: number | null;
      readonly providerMessageId: string | null;
      /** Set when the message went but the row could not be updated. Not a reason to send again. */
      readonly recordError?: string;
    }
  | {
      readonly ok: false;
      readonly mailMessageId: number | null;
      readonly permanent: boolean;
      readonly error: string;
    };

export async function deliver(input: DeliverInput): Promise<DeliverOutcome> {
  const { db, rendered, to, template, correlationId } = input;
  let mailMessageId: number | null = null;

  try {
    const provider = input.provider ?? (await selectProvider());
    const from = input.from ?? mailFrom();
    const sentAt = input.now ?? new Date();

    // The display name stays in the greeting inside the body; the envelope carries the bare address,
    // which is also what a test matches on and what SES event notifications come back keyed by.
    const row = {
      provider: provider.name,
      template,
      toAddress: to.email,
      fromAddress: from,
      subject: rendered.subject,
      bodyText: rendered.text,
      bodyHtml: rendered.html,
      variables: JSON.stringify(rendered.variables),
      status: 'PENDING',
      error: null,
      sentAt: null,
    };

    // No record, no send: a message nobody can account for is worse than a message that is late.
    const opened =
      input.outboxEventId === undefined
        ? await db.mailMessage.create({ data: row, select: { id: true } })
        : await db.mailMessage.upsert({
            where: { outboxEventId: input.outboxEventId },
            create: { ...row, outboxEventId: input.outboxEventId },
            update: row,
            select: { id: true },
          });
    mailMessageId = opened.id;

    let providerMessageId: string | null;
    try {
      const result = await provider.send({
        to: to.email,
        from,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        template,
        correlationId,
      });
      providerMessageId = result.providerMessageId;
    } catch (cause) {
      const error = describeError(cause);
      await db.mailMessage
        .update({ where: { id: opened.id }, data: { status: 'FAILED', error }, select: { id: true } })
        .catch(() => undefined);
      return { ok: false, mailMessageId, permanent: isPermanent(cause), error };
    }

    try {
      await db.mailMessage.update({
        where: { id: opened.id },
        data: { status: 'SENT', sentAt, providerMessageId, error: null },
        select: { id: true },
      });
    } catch (cause) {
      // It really was sent. Reporting a failure here would send it a second time, which is the worse
      // of the two outcomes, so this comes back as a success carrying the record failure.
      return {
        ok: true,
        provider: provider.name,
        mailMessageId,
        providerMessageId,
        recordError: describeError(cause),
      };
    }

    return { ok: true, provider: provider.name, mailMessageId, providerMessageId };
  } catch (cause) {
    return { ok: false, mailMessageId, permanent: isPermanent(cause), error: describeError(cause) };
  }
}

export { createConsoleProvider } from './console.js';
export type { ConsoleProviderOptions } from './console.js';
/** Types only: the SES module itself stays out of the graph until `selectProvider` needs it. */
export type { SesClientLike, SesProviderOptions } from './ses.js';
