import { accountStore, getDb, type Db } from '@oneresi/db';
import { describeError, isPermanent, PayloadError } from './errors.js';
import { asObject, emailAddress } from './decode.js';
import type { OutboxChannel, OutboxEventType } from '@oneresi/contracts';
import { consoleLogger, type Logger } from './types.js';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_INTERVAL_MS,
  DEFAULT_LEASE_MS,
  settle,
  type Settlement,
} from './worker.js';

/**
 * The IN_APP drain — the mail worker's twin for `channel = 'IN_APP'` rows.
 *
 * A handler writes the row inside its own transaction and returns; this worker claims it, resolves
 * the payload's `email` to a person, and inserts the notification the domain's wording function
 * describes. The claim/lease/retry lifecycle is not a copy: `settle`, the attempt constants and
 * the backoff come from `worker.ts`, so all three channels agree about what five attempts mean.
 *
 * The wording is a callback, not an import. The layering rule keeps packages/mail from importing
 * @oneresi/domain — the in-app notification's words are the domain's business — so the
 * composition root (runtime.ts, or the Lambda) supplies the function. The types below are
 * structural: the domain's `inAppNotification(event)` satisfies `InAppWording` because every
 * field lines up, and no package boundary is crossed to say so.
 *
 * Same three properties as the mail and push workers, for the same reasons (D-29, D-30): never
 * throws into a caller, claims before it inserts, and every failure comes back as a value.
 */

// ---------------------------------------------------------------- the seam, restated locally

/**
 * One outbox event, handed to the wording callback. Structurally identical to the domain's
 * `OutboxEventInput` — flat scalars, the recipient convention of store.ts.
 */
export interface InAppEvent {
  readonly type: OutboxEventType;
  readonly channel: OutboxChannel;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: string;
}

/** What the feed says about one event: null when this surface does not word it. */
export interface InAppWordingRow {
  readonly type: OutboxEventType;
  readonly title: string;
  readonly body: string;
  readonly href: string | null;
}

/** Words one claimed row; returns null for an event the feed does not serve. */
export type InAppWording = (event: InAppEvent) => InAppWordingRow | null;

/** Inserts the wording as one notification row for one person. */
export type InAppSink = (userId: number, wording: InAppWordingRow) => Promise<void>;

// ---------------------------------------------------------------- the drain

export interface InAppDrainOptions {
  readonly db?: Db;
  /** The domain's `inAppNotification` — the wording, wired at boot. */
  readonly wording: InAppWording;
  /** The notifications store's `createNotifications`, wired at boot. */
  readonly sink: InAppSink;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface InAppDrainReport {
  /** Rows that were due. */
  readonly considered: number;
  readonly claimed: number;
  /** Rows that became notification rows. */
  readonly notified: number;
  /** Rows this surface does not word — done, not failed, exactly like the push worker. */
  readonly unworded: number;
  readonly retried: number;
  readonly failed: number;
  readonly abandoned: number;
  /** Claimed by somebody else between the read and the claim. Not an error. */
  readonly lost: number;
  readonly problems: readonly string[];
}

/** One pass over `channel = 'IN_APP'` rows. Returns what happened and never throws. */
export async function drainInAppOutbox(
  options: InAppDrainOptions,
): Promise<InAppDrainReport> {
  const logger = options.logger ?? consoleLogger;
  const clock = options.now ?? ((): Date => new Date());
  const random = options.random ?? Math.random;
  const problems: string[] = [];

  let considered = 0;
  let claimed = 0;
  let notified = 0;
  let unworded = 0;
  let retried = 0;
  let failed = 0;
  let abandoned = 0;
  let lost = 0;

  const note = (message: string): void => {
    problems.push(message);
    logger.warn(`in-app worker · ${message}`);
  };

  try {
    const db = options.db ?? (await getDb());
    const accounts = accountStore(db);
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const startedAt = clock();

    const due = await db.outboxEvent.findMany({
      where: { channel: 'IN_APP', status: 'PENDING', availableAt: { lte: startedAt } },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: options.batchSize ?? DEFAULT_BATCH_SIZE,
      select: { id: true, type: true, payload: true, attempts: true, correlationId: true },
    });
    considered = due.length;

    for (const row of due) {
      const attempt = row.attempts + 1;

      // The claim — the same compare-and-swap on the row's own attempt count, so two workers
      // reading the same row produce exactly one winner (D-29).
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

      let settlement: Settlement | 'notified' | 'unworded';
      try {
        const job = decodeInAppJob(row.type, row.payload);

        const account = await accounts.findAccountByEmail(job.email);
        if (account === null) {
          // The person is gone. There is nobody to notify and nobody to retry towards, so the
          // row is done, not failed — the same rule the push worker keeps.
          await db.outboxEvent.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: clock(), lastError: null },
            select: { id: true },
          });
          settlement = 'unworded';
        } else {
          const event: InAppEvent = {
            type: job.type,
            channel: 'IN_APP',
            payload: job.payload,
            correlationId: row.correlationId,
          };
          const wording = options.wording(event);
          if (wording === null) {
            // An event this surface does not word is not this worker's problem to report. Done.
            await db.outboxEvent.update({
              where: { id: row.id },
              data: { status: 'SENT', sentAt: clock(), lastError: null },
              select: { id: true },
            });
            settlement = 'unworded';
          } else {
            await options.sink(account.id, wording);
            await db.outboxEvent.update({
              where: { id: row.id },
              data: { status: 'SENT', sentAt: clock(), lastError: null },
              select: { id: true },
            });
            settlement = 'notified';
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
        case 'notified':
          notified += 1;
          break;
        case 'unworded':
          unworded += 1;
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

  if (notified > 0) {
    logger.info(
      `in-app worker · notified ${notified}, unworded ${unworded}, retrying ${retried}, failed ${failed}, abandoned ${abandoned}`,
    );
  }

  return { considered, claimed, notified, unworded, retried, failed, abandoned, lost, problems };
}

/**
 * What the IN_APP worker reads back out of a `channel = 'IN_APP'` row — the same flat-payload
 * rule the push worker keeps: the `email` key identifies the recipient, every other key is a
 * variable the wording reads at the top level.
 */
export interface InAppJob {
  readonly type: OutboxEventType;
  readonly email: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

export function decodeInAppJob(eventType: string, payload: string): InAppJob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    throw new PayloadError('The outbox payload is not valid JSON', { cause });
  }

  const raw = asObject(parsed);

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

  return { type: eventType as OutboxEventType, email: emailAddress(raw, 'email'), payload: job };
}

// ---------------------------------------------------------------- the local worker

export interface InAppWorkerOptions extends InAppDrainOptions {
  readonly intervalMs?: number;
}

export interface InAppWorkerHandle {
  readonly intervalMs: number;
  /** Stops the timer and waits for a pass that is already running. */
  stop(): Promise<void>;
}

/**
 * The local in-app worker: one drain every few seconds, in-process, never two at once — the same
 * shape as `startMailWorker` over the same interval. On AWS this loop does not exist: the
 * Lambda's handler drains all three channels once per invocation.
 */
export function startInAppWorker(options: InAppWorkerOptions): InAppWorkerHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = options.logger ?? consoleLogger;
  let inFlight: Promise<unknown> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight !== null) return;
    inFlight = drainInAppOutbox(options)
      .catch((cause: unknown) => {
        logger.warn(`in-app worker · unexpected: ${describeError(cause)}`);
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
