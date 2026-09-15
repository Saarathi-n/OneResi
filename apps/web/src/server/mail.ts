import { getDb, closeDb, type Db } from '@grihaone/db';
import { requeueFailed } from '@grihaone/mail/worker';
import type { Actor, Result } from '@grihaone/domain';
import { errors } from '@grihaone/domain';

/**
 * The committee's mail log, in the server module where database access belongs (WIRING rule 4).
 * The line IS the outbox row — the pipeline's own record of one message to one recipient — with
 * the provider's verdict joined on: what SES said happened to it, and the rendered subject once
 * a send has been attempted. Listing from the outbox (not mail_message) is what makes the log
 * complete: a message published seconds ago, not yet attempted by the notifier, appears as
 * `queued` rather than being invisible until its first attempt.
 */

/** One line of the log: the outbox row's truth, plus the provider's verdict where one exists. */
export interface MailLine {
  readonly id: number;
  readonly toAddress: string | null;
  readonly subject: string | null;
  readonly template: string | null;
  readonly provider: string | null;
  /** The pipeline status: queued | retrying | sent | failed | abandoned. */
  readonly status: string;
  readonly deliveryState: string | null;
  readonly error: string | null;
  readonly attempts: number;
  readonly createdAt: string;
  readonly sentAt: string | null;
}

/** The recipient from an un-attempted row's payload, where the event carries one. */
function payloadEmail(payload: string): string | null {
  try {
    const email = (JSON.parse(payload) as { email?: unknown }).email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

function pipelineStatus(outboxStatus: string, attempts: number): string {
  if (outboxStatus === 'PENDING') return attempts === 0 ? 'queued' : 'retrying';
  return outboxStatus.toLowerCase();
}

/** Reads the newest email outbox rows, newest first, with the provider's verdict joined on. */
export async function mailLog(actor: Actor, limit = 100): Promise<Result<readonly MailLine[]>> {
  if (actor.role !== 'A') return errors.forbidden('read the mail log');

  const db: Db = await getDb();
  try {
    const rows = await db.outboxEvent.findMany({
      where: { channel: 'EMAIL' },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { mail: { select: { toAddress: true, subject: true, template: true, provider: true, deliveryState: true, sentAt: true } } },
    });
    return {
      ok: true,
      value: rows.map((row) => ({
        id: row.id,
        toAddress: row.mail?.toAddress ?? payloadEmail(row.payload),
        subject: row.mail?.subject ?? null,
        template: row.mail?.template ?? null,
        provider: row.mail?.provider ?? null,
        status: pipelineStatus(row.status, row.attempts),
        deliveryState: row.mail?.deliveryState ?? null,
        error: row.lastError,
        attempts: row.attempts,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.mail?.sentAt === undefined || row.mail.sentAt === null ? null : row.mail.sentAt.toISOString(),
      })),
    };
  } finally {
    await closeDb().catch(() => undefined);
  }
}

/**
 * Requeues every FAILED email row for one more attempt each — the resend path the worker's
 * design documents ("a FAILED row waits for a person; this is that person pressing the button").
 * Returns how many rows got another chance.
 */
export async function requeueFailedMail(actor: Actor): Promise<Result<{ requeued: number }>> {
  if (actor.role !== 'A') return errors.forbidden('requeue mail');

  const db: Db = await getDb();
  try {
    const requeued = await requeueFailed({ db });
    return { ok: true, value: { requeued } };
  } finally {
    await closeDb().catch(() => undefined);
  }
}
