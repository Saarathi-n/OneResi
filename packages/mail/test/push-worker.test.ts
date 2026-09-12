import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@grihaone/db';
import { collectingLogger } from '../src/testing.js';
import { backoffMs, MAX_ATTEMPTS } from '../src/worker.js';
import {
  drainPushOutbox,
  type PushDispatchOutcome,
  type PushDispatcher,
  type PushEvent,
  type PushDrainReport,
} from '../src/push-worker.js';
import { testDatabase } from '../../../test/helpers/database.js';

/**
 * The PUSH drain, against a real database — the same harness `worker.test.ts` keeps, because this
 * is the same lifecycle one channel over: claim by compare-and-swap, settle through `worker.ts`'s
 * own constants and backoff, never throw into the caller (D-29).
 *
 * What is asserted is the contract the task named: a PUSH row is claimed and dispatched to the
 * person the payload names; EMAIL rows are untouched; an account that no longer exists settles
 * the row rather than retrying it; a dispatch that failed comes back after the backoff with the
 * reason on the row; and a report of all zeros — an event the wording does not serve — is a
 * completed row, not a failure.
 *
 * The dispatcher is a double standing where `notifications.dispatchPush` is wired in runtime.ts.
 * Its arguments are recorded, because "resolved the payload's email to the right userId" is the
 * drain's own job, not the dispatcher's.
 */

const EMAIL = 'priya@grihaone.local';
const OTHER_EMAIL = 'arjun@grihaone.local';

let db: Db;
let nowMs: number;
const clock = (): Date => new Date(nowMs);
const quiet = collectingLogger();

/** The account the payload's email resolves to. */
let priyaId: number;

interface RowOverrides {
  readonly type?: string;
  readonly channel?: string;
  readonly payload?: string;
  readonly attempts?: number;
  readonly availableAt?: Date;
  readonly status?: string;
}

/** A PUSH row exactly as a handler would write it: flat payload, the recipient by email. */
async function aPendingRow(overrides: RowOverrides = {}): Promise<number> {
  const row = await db.outboxEvent.create({
    data: {
      type: 'visitor.arrived',
      channel: 'PUSH',
      payload: JSON.stringify({
        name: 'Priya Menon',
        email: EMAIL,
        visitorName: 'Ravi',
        purpose: 'Delivery',
      }),
      status: 'PENDING',
      attempts: 0,
      availableAt: clock(),
      correlationId: 'corr-test',
      ...overrides,
    },
    select: { id: true },
  });
  return row.id;
}

interface DispatchDouble {
  readonly dispatch: PushDispatcher;
  /** What the dispatcher was asked, in order. */
  readonly asked: readonly { readonly userId: number; readonly event: PushEvent }[];
  /** What the next call answers. */
  answer: (outcome: PushDispatchOutcome) => void;
}

/**
 * A dispatcher double. The real one — the notifications service — is covered by
 * `packages/domain/src/notifications.test.ts`; what matters here is what the drain hands it and
 * how it marks the row by the report it gets back.
 */
function aDispatcher(first: PushDispatchOutcome): DispatchDouble {
  const asked: { userId: number; event: PushEvent }[] = [];
  let next = first;

  return {
    asked,
    dispatch: async (userId, event) => {
      asked.push({ userId, event });
      return next;
    },
    answer: (outcome) => {
      next = outcome;
    },
  };
}

function aDeliveredReport(): PushDispatchOutcome {
  return { ok: true, value: { addressed: 1, sent: 1, failed: 0, retired: 0, problems: [] } };
}

function drain(
  dispatch: PushDispatcher,
  extra: Partial<Parameters<typeof drainPushOutbox>[0]> = {},
): Promise<PushDrainReport> {
  return drainPushOutbox({
    db,
    dispatch,
    now: clock,
    random: () => 0.5,
    logger: quiet.logger,
    ...extra,
  });
}

beforeAll(async () => {
  const opened = await testDatabase();
  db = opened.db;
  nowMs = Date.parse('2026-09-08T10:00:00.000Z');
});

beforeEach(async () => {
  await db.outboxEvent.deleteMany();
  await db.residentUser.deleteMany();

  const account = await db.residentUser.create({
    data: {
      name: 'Priya Menon',
      email: EMAIL,
      phone: '9876543210',
      passwordHash: '$2b$12$not-a-real-hash-for-a-fixture',
      role: 'R',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  priyaId = account.id;
});

describe('the success path', () => {
  it('claims the row, resolves the email, and dispatches to the person it names', async () => {
    const id = await aPendingRow();
    const double = aDispatcher(aDeliveredReport());

    const report = await drain(double.dispatch);

    expect(report).toEqual({
      considered: 1,
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
      abandoned: 0,
      lost: 0,
      problems: [],
    });

    // The drain resolved the payload's email to the account's id — that lookup is its job, and
    // the dispatcher only ever sees a userId. The event is the decoded payload, flat, with the
    // correlation id that ties the lock-screen message back to the request that caused it.
    expect(double.asked).toHaveLength(1);
    expect(double.asked[0]?.userId).toBe(priyaId);
    expect(double.asked[0]?.event).toEqual({
      type: 'visitor.arrived',
      channel: 'PUSH',
      payload: { name: 'Priya Menon', email: EMAIL, visitorName: 'Ravi', purpose: 'Delivery' },
      correlationId: 'corr-test',
    });

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toBeNull();
    expect(outbox.sentAt).toEqual(clock());
  });

  it("accepts the mail envelope's recipient spelling (`to.email`) too", async () => {
    const id = await aPendingRow({
      payload: JSON.stringify({
        to: { email: EMAIL, name: 'Priya Menon' },
        visitorName: 'Ravi',
        purpose: 'Delivery',
      }),
    });
    const double = aDispatcher(aDeliveredReport());

    await drain(double.dispatch);

    expect(double.asked[0]?.userId).toBe(priyaId);
    // The `to` envelope is unwrapped for the recipient and stripped from the event: the wording
    // reads flat variables, and a nested envelope would render "undefined" on a lock screen.
    expect(double.asked[0]?.event.payload).toEqual({ visitorName: 'Ravi', purpose: 'Delivery' });
    expect(await db.outboxEvent.count({ where: { id, status: 'SENT' } })).toBe(1);
  });
});

describe("rows that are not this worker's", () => {
  it('never touches an EMAIL row, in either direction', async () => {
    const emailId = await aPendingRow({ channel: 'EMAIL' });
    const double = aDispatcher(aDeliveredReport());

    const report = await drain(double.dispatch);

    expect(report).toMatchObject({ considered: 0, claimed: 0, sent: 0 });
    expect(double.asked).toHaveLength(0);
    const email = await db.outboxEvent.findUniqueOrThrow({ where: { id: emailId } });
    expect(email.status).toBe('PENDING');
    expect(email.attempts).toBe(0);
  });
});

describe('a person the database no longer knows', () => {
  it('settles the row — done, not failed, and dispatched to nobody', async () => {
    const id = await aPendingRow({
      payload: JSON.stringify({ email: OTHER_EMAIL, visitorName: 'Ravi' }),
    });
    const double = aDispatcher(aDeliveredReport());

    const report = await drain(double.dispatch);

    // An account that no longer exists must not hold a place in the queue forever: the row is
    // marked SENT and counted, and no dispatch happens — there is nobody to dispatch to.
    expect(report).toMatchObject({ considered: 1, claimed: 1, sent: 1, retried: 0, problems: [] });
    expect(double.asked).toHaveLength(0);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toBeNull();
  });
});

describe('a dispatch that failed', () => {
  it('records the retry attempt with the backoff and the reason', async () => {
    const id = await aPendingRow();
    const double = aDispatcher({
      ok: true,
      value: {
        addressed: 2,
        sent: 1,
        failed: 1,
        retired: 0,
        problems: ['https://fcm.googleapis.com/fcm/send/dE2xW9qTr7 was not delivered: status 503'],
      },
    });

    const report = await drain(double.dispatch);

    // One of two subscriptions failed, so the row as a whole is not done: it comes back after
    // the backoff, the same arithmetic the mail worker keeps (`random` pinned, so exactly one
    // backoff step).
    expect(report).toMatchObject({ considered: 1, claimed: 1, sent: 0, retried: 1, problems: [] });

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('PENDING');
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toContain('status 503');
    expect(outbox.availableAt).toEqual(new Date(nowMs + backoffMs(1)));

    // And it is not due again until the backoff has passed.
    const immediate = await drain(aDispatcher(aDeliveredReport()));
    expect(immediate.considered).toBe(0);

    nowMs += backoffMs(1) + 1;
    double.answer(aDeliveredReport());
    const retry = await drain(double.dispatch);
    expect(retry).toMatchObject({ considered: 1, claimed: 1, sent: 1 });
    expect(await db.outboxEvent.count({ where: { id, status: 'SENT' } })).toBe(1);
  });

  it("fails the row for a person after MAX_ATTEMPTS, with the report's reason on it", async () => {
    const id = await aPendingRow({ attempts: MAX_ATTEMPTS - 1 });
    const double = aDispatcher({
      ok: true,
      value: {
        addressed: 1,
        sent: 0,
        failed: 1,
        retired: 0,
        problems: ['the push service refused'],
      },
    });

    const report = await drain(double.dispatch);

    expect(report).toMatchObject({ sent: 0, retried: 0, failed: 1 });
    expect(report.problems[0]).toMatch(/failed after 5 attempts and is waiting for someone/);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('FAILED');
    expect(outbox.lastError).toContain('the push service refused');
  });

  it('counts a dispatcher that refused the event itself as transient, with its message', async () => {
    const id = await aPendingRow();
    const double = aDispatcher({
      ok: false,
      error: { code: 'STORE_UNAVAILABLE', message: 'The subscription table is unreachable' },
    });

    const report = await drain(double.dispatch);

    expect(report).toMatchObject({ sent: 0, retried: 1, problems: [] });
    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('PENDING');
    expect(outbox.lastError).toContain('dispatch refused (STORE_UNAVAILABLE)');
    expect(outbox.lastError).toContain('The subscription table is unreachable');
  });
});

describe('a report of all zeros', () => {
  it('marks the row SENT — an unworded event is done, not a failure', async () => {
    const id = await aPendingRow({ type: 'invoice.raised' });
    const double = aDispatcher({
      // What `notifications.dispatchPush` answers for an event its wording does not serve:
      // addressed to nobody, nothing sent, nothing failed. The wording is the domain's; the
      // drain's contract is that this report completes the row.
      ok: true,
      value: { addressed: 0, sent: 0, failed: 0, retired: 0, problems: [] },
    });

    const report = await drain(double.dispatch);

    expect(report).toMatchObject({ considered: 1, claimed: 1, sent: 1, retried: 0 });
    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.lastError).toBeNull();
  });

  it('marks the row SENT when the dispatch only retired dead subscriptions', async () => {
    const id = await aPendingRow();
    const double = aDispatcher({
      ok: true,
      value: { addressed: 1, sent: 0, failed: 0, retired: 1, problems: [] },
    });

    const report = await drain(double.dispatch);

    // Retiring a subscription the push service declared gone is the honest answer, never a
    // reason to spend four more attempts on a device that will never receive anything.
    expect(report).toMatchObject({ sent: 1, retried: 0, failed: 0 });
    expect(await db.outboxEvent.count({ where: { id, status: 'SENT' } })).toBe(1);
  });
});

describe('a payload the drain cannot decode', () => {
  it('abandons the row — a poison payload cannot be improved by five attempts', async () => {
    const id = await aPendingRow({ type: 'not.an.event' });
    const double = aDispatcher(aDeliveredReport());

    const report = await drain(double.dispatch);

    expect(report).toMatchObject({ sent: 0, retried: 0, abandoned: 1 });
    expect(report.problems[0]).toMatch(/abandoned on attempt 1/);
    expect(double.asked).toHaveLength(0);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('ABANDONED');
    expect(outbox.lastError).toContain('not.an.event');
  });
});
