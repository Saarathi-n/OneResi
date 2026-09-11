import type { OutboxChannel, OutboxEventType } from '@oneresi/contracts';
import { accountStore, getDb, type Db } from '@oneresi/db';
import { describeError, isPermanent } from './errors.js';
import { decodePushJob } from './payload.js';
import { consoleLogger, type Logger } from './types.js';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_INTERVAL_MS,
  DEFAULT_LEASE_MS,
  settle,
  type Settlement,
} from './worker.js';

/**
 * The PUSH drain — `drainOutbox`'s twin for `channel = 'PUSH'` rows.
 *
 * A handler writes the row inside its own transaction and returns; this worker claims it, resolves
 * the payload's `email` to a person, and hands the event to the dispatcher — the notifications
 * service's `dispatchPush`, which owns the wording and every active subscription the person holds.
 * The claim/lease/retry lifecycle is not a copy: `settle`, the attempt constants and the backoff
 * come from `worker.ts`, so the two channels can never disagree about what five attempts mean.
 *
 * The dispatcher is a callback, not an import. The layering in docs/plan/WIRING.md keeps
 * packages/mail from importing @oneresi/domain — the push wording is the domain's business — so
 * the composition root (runtime.ts, or the Lambda) supplies the function. The types below are
 * structural: `notifications.dispatchPush({userId, event})` satisfies `PushDispatcher` because
 * every field lines up, and no package boundary is crossed to say so.
 *
 * Same three properties as the mail worker, for the same reasons (D-29, D-30): never throws into a
 * caller, claims before it dispatches, and every failure comes back as a value in the report.
 */

// ---------------------------------------------------------------- the seam, restated locally

/**
 * One outbox event, handed to the dispatcher. Structurally identical to the domain's
 * `OutboxEventInput` — flat scalars, the recipient convention of `store.ts`.
 */
export interface PushEvent {
  readonly type: OutboxEventType;
  readonly channel: OutboxChannel;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: string;
}

/** What one dispatch actually did — the domain's `PushDispatchReport`, restated. */
export interface PushDispatchReport {
  /** Active subscriptions the person held when the event was dispatched. */
  readonly addressed: number;
  readonly sent: number;
  /** Transient failures. The worker's call to retry. */
  readonly failed: number;
  /** Subscriptions the push service declared dead, retired by the dispatch. Not a failure. */
  readonly retired: number;
  readonly problems: readonly string[];
}

export type PushDispatchOutcome =
  | { readonly ok: true; readonly value: PushDispatchReport }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** Resolves one claimed row to whatever the person's devices did with it. */
export type PushDispatcher = (userId: number, event: PushEvent) => Promise<PushDispatchOutcome>;

// ---------------------------------------------------------------- the drain

export interface PushDrainOptions {
  readonly db?: Db;
  /** The one dependency with no default: the notifications service's dispatchPush, wired at boot. */
  readonly dispatch: PushDispatcher;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface PushDrainReport {
  /** Rows that were due. */
  readonly considered: number;
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly abandoned: number;
  /** Claimed by somebody else between the read and the claim. Not an error. */
  readonly lost: number;
  /** Anything that went wrong, in order. The caller decides whether to care. */
  readonly problems: readonly string[];
}

/**
 * One pass over `channel = 'PUSH'` rows. Returns what happened and never throws.
 *
 * EMAIL and IN_APP rows are not touched — they belong to their own workers and must be left
 * exactly as they are.
 */
export async function drainPushOutbox(options: PushDrainOptions): Promise<PushDrainReport> {
  const logger = options.logger ?? consoleLogger;
  const clock = options.now ?? ((): Date => new Date());
  const random = options.random ?? Math.random;
  const problems: string[] = [];

  let considered = 0;
  let claimed = 0;
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let abandoned = 0;
  let lost = 0;

  const note = (message: string): void => {
    problems.push(message);
    logger.warn(`push worker · ${message}`);
  };

  try {
    const db = options.db ?? (await getDb());
    const accounts = accountStore(db);
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const startedAt = clock();

    const due = await db.outboxEvent.findMany({
      where: { channel: 'PUSH', status: 'PENDING', availableAt: { lte: startedAt } },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: options.batchSize ?? DEFAULT_BATCH_SIZE,
      select: { id: true, type: true, payload: true, attempts: true, correlationId: true },
    });
    considered = due.length;

    for (const row of due) {
      const attempt = row.attempts + 1;

      // The claim — the same compare-and-swap on the row's own attempt count as the mail worker,
      // so two workers reading the same row produce exactly one winner (D-29).
      const won = await db.outboxEvent.updateMany({
        where: {
          id: row.id,
          status: 'PENDING',
          attempts: row.attempts,
          availableAt: { lte: startedAt },
        },
        data: { attempts: attempt, availableAt: new Date(clock().getTime() + leaseMs) },
      });
      if (won.count !== 1) {
        lost += 1;
        continue;
      }
      claimed += 1;

      let settlement: Settlement | 'sent';
      try {
        const job = decodePushJob(row.type, row.payload);

        const account = await accounts.findAccountByEmail(job.email);
        if (account === null) {
          // The person is gone — declined, or deleted. There is nobody to notify and nobody to
          // retry towards, so the row is done, not failed: an account that no longer exists
          // must not hold a place in the queue forever.
          await db.outboxEvent.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: clock(), lastError: null },
            select: { id: true },
          });
          settlement = 'sent';
        } else {
          const event: PushEvent = {
            type: job.type,
            channel: 'PUSH',
            payload: job.payload,
            correlationId: row.correlationId,
          };
          const outcome = await options.dispatch(account.id, event);

          if (!outcome.ok) {
            // The dispatcher refused the event itself (not one subscription). Its message is the
            // reason on the row; transient, because a service error is somebody's to fix.
            settlement = await settle({
              db,
              id: row.id,
              attempt,
              error: `dispatch refused (${outcome.error.code}): ${outcome.error.message}`,
              permanent: false,
              at: clock(),
              random,
            });
          } else if (outcome.value.failed > 0) {
            const detail =
              outcome.value.problems.length > 0
                ? outcome.value.problems.join('; ')
                : `${outcome.value.failed} of ${outcome.value.addressed} subscriptions failed`;
            settlement = await settle({
              db,
              id: row.id,
              attempt,
              error: detail,
              permanent: false,
              at: clock(),
              random,
            });
          } else {
            // Sent, or addressed to nobody: an unworded event reports all zeros and is done, and a
            // dispatch that only retired dead subscriptions succeeded — retiring is the honest
            // answer to a subscription the push service says is gone, never a reason to retry.
            // A duplicate on a retry would show on a lock screen twice, which is the one way this
            // marking can be wrong, and it costs less than dropping a notification a person expected.
            await db.outboxEvent.update({
              where: { id: row.id },
              data: { status: 'SENT', sentAt: clock(), lastError: null },
              select: { id: true },
            });
            settlement = 'sent';
          }
        }
      } catch (cause) {
        settlement = await settle({
          db,
          id: row.id,
          attempt,
          error: describeError(cause),
          permanent: isPermanent(cause),
          at: clock(),
          random,
        });
      }

      switch (settlement) {
        case 'sent':
          sent += 1;
          break;
        case 'retried':
          retried += 1;
          break;
        case 'failed':
          failed += 1;
          note(`row ${row.id} failed after ${attempt} attempts and is waiting for someone`);
          break;
        case 'abandoned':
          abandoned += 1;
          note(`row ${row.id} was abandoned on attempt ${attempt}; it will not be tried again`);
          break;
        case 'unsettled':
          note(
            `row ${row.id} could not be updated after its attempt; it returns when the claim expires`,
          );
          break;
        default: {
          const unreachable: never = settlement;
          throw new Error(`Unhandled settlement: ${String(unreachable)}`);
        }
      }
    }
  } catch (cause) {
    // Including a database that is not there. The caller gets a report, not an exception.
    note(describeError(cause));
  }

  if (sent > 0) {
    logger.info(
      `push worker · sent ${sent}, retrying ${retried}, failed ${failed}, abandoned ${abandoned}`,
    );
  }

  return { considered, claimed, sent, retried, failed, abandoned, lost, problems };
}

// ---------------------------------------------------------------- the local worker

export interface PushWorkerOptions extends PushDrainOptions {
  readonly intervalMs?: number;
}

export interface PushWorkerHandle {
  readonly intervalMs: number;
  /** Stops the timer and waits for a pass that is already running. */
  stop(): Promise<void>;
}

/**
 * The local push worker: one drain every few seconds, in-process, never two at once — the same
 * shape as `startMailWorker` over the same interval, because locally the two channels are one
 * process's two timers. On AWS this loop does not exist: the Lambda's handler calls
 * `drainPushOutbox` once per invocation, next to the email drain.
 */
export function startPushWorker(options: PushWorkerOptions): PushWorkerHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = options.logger ?? consoleLogger;
  let inFlight: Promise<unknown> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight !== null) return;
    inFlight = drainPushOutbox(options)
      .catch((cause: unknown) => {
        // drainPushOutbox does not throw; this is here so a bug in it cannot become an unhandled
        // rejection that takes the process down with it.
        logger.warn(`push worker · unexpected: ${describeError(cause)}`);
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();

  return {
    intervalMs,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
