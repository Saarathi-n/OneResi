import { getDb, type Db } from '@grihaone/db';
import { describeError, isPermanent } from './errors.js';
import { decodeMailJob } from './payload.js';
import { deliver, selectProvider } from './providers/index.js';
import { renderById } from './render.js';
import { consoleLogger, type Logger, type MailProvider } from './types.js';

/**
 * The outbox worker.
 *
 * A handler writes an `OutboxEvent` row inside the same transaction as the change it made, and returns.
 * This drains those rows: render, send, record, mark. Locally it runs on an interval in-process; on AWS
 * the same function runs in a Lambda behind SQS. Same code, same contract, both sides.
 *
 * Three properties matter more than anything else here.
 *
 * **It never throws into a caller.** Every failure — a malformed payload, a provider that is down, the
 * database itself — comes back as a value in the report. The billing run must not fail because mail is
 * down; that is the whole reason the outbox exists (D-29).
 *
 * **A row is claimed before it is sent.** Two workers, or one worker and a retry of itself, cannot send
 * the same message twice: claiming is a conditional update on the row's own attempt count, so exactly
 * one caller wins and the loser moves on.
 *
 * **Failures are visible.** The row carries the attempt count and the last error, and the `MailMessage`
 * row carries the same, which is what the mail suite reads. The previous build wrapped an inline send
 * in a try/catch, so failures were invisible (D-29, D-30).
 */

/** Attempts before a row is left `FAILED` for a person to look at. */
export const MAX_ATTEMPTS = 5;

/**
 * Attempts before it is `ABANDONED` and never tried again by anything. Only reachable through
 * `requeueFailed`, which gives a `FAILED` row one more chance at a time.
 */
export const ABANDON_AFTER_ATTEMPTS = 8;

export const BASE_BACKOFF_MS = 15_000;
export const MAX_BACKOFF_MS = 15 * 60_000;
export const DEFAULT_BATCH_SIZE = 25;

/**
 * How long a claim holds a row. A worker that dies mid-send leaves the row claimed until this passes,
 * then it is retried — having spent one attempt, which is the conservative direction: a message that
 * crashes the process must not be able to spin forever.
 */
export const DEFAULT_LEASE_MS = 60_000;

/** Doubling, capped. `attempt` is the number of the attempt that just failed. */
export function backoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

/** ±20%, so two workers that fail together do not come back in lockstep. */
function jittered(milliseconds: number, random: () => number): number {
  return Math.round(milliseconds * (0.8 + 0.4 * random()));
}

export interface DrainOptions {
  readonly db?: Db;
  readonly provider?: MailProvider;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly random?: () => number;
  /** Overrides `APP_ORIGIN`, for a preview or a test. */
  readonly origin?: string;
}

export interface DrainReport {
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
 * Where a failed row lands, and the settling itself. Exported because the PUSH drain
 * (`push-worker.ts`) marks its rows through the exact same lifecycle — the constants, the backoff
 * and this function are the outbox's retry contract, and forking them here is how the two workers
 * would drift into disagreeing about what five attempts mean.
 */
export type Settlement = 'retried' | 'failed' | 'abandoned' | 'unsettled';

interface SettleInput {
  readonly db: Db;
  readonly id: number;
  /** The attempt that just failed. */
  readonly attempt: number;
  readonly error: string;
  readonly permanent: boolean;
  readonly at: Date;
  readonly random: () => number;
}

/**
 * Where a failed row lands.
 *
 * Permanent means the message itself is wrong — a payload that will never parse, a template that does
 * not exist, an address SES has rejected outright. Five attempts cannot improve any of those, and a
 * poison row that keeps coming back hides everything queued behind it, so it is abandoned with the
 * reason on the row.
 */
export async function settle(input: SettleInput): Promise<Settlement> {
  const status =
    input.permanent || input.attempt >= ABANDON_AFTER_ATTEMPTS
      ? 'ABANDONED'
      : input.attempt >= MAX_ATTEMPTS
        ? 'FAILED'
        : 'PENDING';

  try {
    if (status === 'PENDING') {
      const availableAt = new Date(
        input.at.getTime() + jittered(backoffMs(input.attempt), input.random),
      );
      await input.db.outboxEvent.update({
        where: { id: input.id },
        data: { status, lastError: input.error, availableAt },
        select: { id: true },
      });
      return 'retried';
    }

    await input.db.outboxEvent.update({
      where: { id: input.id },
      data: { status, lastError: input.error },
      select: { id: true },
    });
    return status === 'FAILED' ? 'failed' : 'abandoned';
  } catch {
    // The database is unreachable too. The claim lease expires on its own and the row comes back.
    return 'unsettled';
  }
}

/**
 * One pass. Returns what happened and never throws.
 *
 * Only `channel = 'EMAIL'` rows are touched. Push and in-app rows belong to other workers and must be
 * left exactly as they are.
 */
export async function drainOutbox(options: DrainOptions = {}): Promise<DrainReport> {
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
    logger.warn(`mail worker · ${message}`);
  };

  try {
    const db = options.db ?? (await getDb());
    // Resolved before anything is claimed, so a misconfigured provider costs no attempts.
    const provider = options.provider ?? (await selectProvider());
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const origin = options.origin;
    const startedAt = clock();

    const due = await db.outboxEvent.findMany({
      where: { channel: 'EMAIL', status: 'PENDING', availableAt: { lte: startedAt } },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: options.batchSize ?? DEFAULT_BATCH_SIZE,
      select: { id: true, type: true, payload: true, attempts: true, correlationId: true },
    });
    considered = due.length;

    for (const row of due) {
      const attempt = row.attempts + 1;

      // The claim. Conditional on the attempt count we read, so it is a compare-and-swap: two workers
      // reading the same row produce exactly one winner, and the loser's update matches nothing.
      // `availableAt` doubles as the lease, which is why the status vocabulary needs no CLAIMED state.
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
        const job = decodeMailJob(row.type, row.payload);
        const rendered = renderById(
          job.template,
          job.vars,
          origin === undefined ? {} : { origin },
        );

        const delivered = await deliver({
          db,
          to: job.to,
          template: job.template,
          rendered,
          correlationId: row.correlationId,
          outboxEventId: row.id,
          provider,
        });

        if (delivered.ok) {
          if (delivered.recordError !== undefined) {
            note(`row ${row.id} went out but its mail row did not update: ${delivered.recordError}`);
          }
          try {
            await db.outboxEvent.update({
              where: { id: row.id },
              data: { status: 'SENT', sentAt: clock(), lastError: null },
              select: { id: true },
            });
          } catch (cause) {
            // It was sent. Marking it failed here would be a lie, and marking it sent before sending
            // would lose messages instead of repeating them, which is the worse of the two. So the row
            // stays claimed and comes back when the lease expires: this is the one place the design can
            // deliver twice, and it takes a database outage between the send and this line.
            note(`row ${row.id} was sent but could not be marked sent: ${describeError(cause)}`);
          }
          settlement = 'sent';
        } else {
          settlement = await settle({
            db,
            id: row.id,
            attempt,
            error: delivered.error,
            permanent: delivered.permanent,
            at: clock(),
            random,
          });
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
          note(`row ${row.id} could not be updated after its attempt; it returns when the claim expires`);
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
      `mail worker · sent ${sent}, retrying ${retried}, failed ${failed}, abandoned ${abandoned}`,
    );
  }

  return { considered, claimed, sent, retried, failed, abandoned, lost, problems };
}

export interface MailWorkerOptions extends DrainOptions {
  readonly intervalMs?: number;
}

export interface MailWorkerHandle {
  readonly intervalMs: number;
  /** Stops the timer and waits for a pass that is already running. */
  stop(): Promise<void>;
}

export const DEFAULT_INTERVAL_MS = 5_000;

/**
 * The local worker: one drain every few seconds, in-process, never two at once.
 *
 * On AWS this loop does not exist — SQS invokes a Lambda that calls `drainOutbox` once per batch. The
 * interval is the local equivalent, and it is deliberately the only difference between the two
 * environments (docs/plan/02-architecture.md).
 */
export function startMailWorker(options: MailWorkerOptions = {}): MailWorkerHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = options.logger ?? consoleLogger;
  let inFlight: Promise<unknown> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight !== null) return;
    inFlight = drainOutbox(options)
      .catch((cause: unknown) => {
        // drainOutbox does not throw; this is here so a bug in it cannot become an unhandled rejection
        // that takes the process down with it.
        logger.warn(`mail worker · unexpected: ${describeError(cause)}`);
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

/**
 * Puts `FAILED` rows back in the queue. What the mail log's resend button calls.
 *
 * `ABANDONED` rows are not touched: abandoning means the message itself is wrong, and sending it again
 * unchanged would fail again. Each requeue buys one more attempt, up to `ABANDON_AFTER_ATTEMPTS`.
 */
export async function requeueFailed(
  options: { readonly db?: Db; readonly ids?: readonly number[]; readonly now?: () => Date } = {},
): Promise<number> {
  const db = options.db ?? (await getDb());
  const availableAt = (options.now ?? ((): Date => new Date()))();

  const result = await db.outboxEvent.updateMany({
    where: {
      channel: 'EMAIL',
      status: 'FAILED',
      ...(options.ids === undefined ? {} : { id: { in: [...options.ids] } }),
    },
    data: { status: 'PENDING', availableAt },
  });
  return result.count;
}
