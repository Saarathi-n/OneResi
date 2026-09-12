/**
 * The nightly overdue flag, 00:30 in the society's own timezone: every UNPAID invoice whose due
 * date is strictly before today becomes OVERDUE, with the mail that tells each household.
 *
 * The rule lives in `packages/domain` beside every other rule (`billing.flagOverdue`) — this
 * handler is only the composition: open the database, call the rule, let the outbox carry the
 * mail to the notifier. The comparison it replaces was `due_date < now` against a column holding
 * midnight, which flagged an invoice as overdue at 00:01 on its own due date (D-36); the domain
 * computes "today" in the society's calendar, which for IST has no daylight saving to break it.
 *
 * The database password is fetched from Secrets Manager under the one ARN this role can read.
 */
import { cloudDatabaseUrlFromParts, getDb, closeDb, billingStore } from '@oneresi/db';
import { billingService } from '@oneresi/domain';

interface ScheduledEvent {
  'detail-type'?: string;
  job?: string;
}

export async function handler(event: ScheduledEvent): Promise<{ flagged: number }> {
  void event;
  const url = await cloudDatabaseUrlFromParts();
  if (url !== null) process.env['DATABASE_URL'] = url;

  const db = await getDb();
  try {
    const billing = billingService({ store: billingStore(db), clock: { now: (): Date => new Date() } });
    const result = await billing.flagOverdue(
      { role: 'SYSTEM', reason: 'nightly overdue flag' },
      new Date(),
    );
    if (!result.ok) {
      // The rule refused — nothing was flagged and the reason is for the log, not a retry. A
      // refused rule is a completed run; throwing here would re-run a job that said no.
      console.warn(JSON.stringify({ level: 'warn', message: 'overdue flag refused', detail: result.error.code }));
      return { flagged: 0 };
    }
    return { flagged: result.value.flagged };
  } finally {
    await closeDb().catch(() => undefined);
  }
}
