import { getDb, closeDb, type Db } from '@grihaone/db';
import { requeueFailed } from '@grihaone/mail/worker';
import type { Actor, Result } from '@grihaone/domain';
import { errors } from '@grihaone/domain';

/**
 * The committee's mail log, in the server module where database access belongs (WIRING rule 4):
 * every message the system ever wrote — sent, failed, bounced, abandoned — plus the one operation
 * a person performs on it, requeueing what failed. This is the screen that makes the mail
 * pipeline observable from the app itself: delivery receipts, retry counts, and the resend all
 * live here, so nobody has to query the database by hand to answer "did the mail go out?".
 */

/** One line of the log. The row is the truth; nothing here is derived or guessed. */
export interface MailLine {
  readonly id: number;
  readonly toAddress: string;
  readonly subject: string;
  readonly template: string;
  readonly provider: string;
  readonly status: string;
  readonly deliveryState: string | null;
  readonly error: string | null;
  readonly attempts: number | null;
  readonly outboxStatus: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
}

/** Reads the newest mail rows, newest first. The page caps what it shows; the query caps harder. */
export async function mailLog(actor: Actor, limit = 100): Promise<Result<readonly MailLine[]>> {
  if (actor.role !== 'A') return errors.forbidden('read the mail log');

  const db: Db = await getDb();
  try {
    const rows = await db.mailMessage.findMany({
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { outboxEvent: { select: { attempts: true, status: true } } },
    });
    return {
      ok: true,
      value: rows.map((row) => ({
        id: row.id,
        toAddress: row.toAddress,
        subject: row.subject,
        template: row.template,
        provider: row.provider,
        status: row.status,
        deliveryState: row.deliveryState,
        error: row.error,
        attempts: row.outboxEvent?.attempts ?? null,
        outboxStatus: row.outboxEvent?.status ?? null,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt === null ? null : row.sentAt.toISOString(),
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
