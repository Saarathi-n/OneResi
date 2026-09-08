import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@oneresi/db';
import { encodeMailJob } from '../src/payload.js';
import { createSesProvider } from '../src/providers/ses.js';
import {
  collectingLogger,
  expectMail,
  failingProvider,
  recordingSesClient,
  resetMailTesting,
  setMailTestDatabase,
} from '../src/testing.js';
import {
  backoffMs,
  drainOutbox,
  MAX_ATTEMPTS,
  type DrainReport,
} from '../src/worker.js';
import { testDatabase } from '../../../test/helpers/database.js';

/**
 * Tier 1 of the mail suite (docs/plan/05-testing.md): the outbox worker, against a real database.
 *
 * What is asserted is the set of properties the worker exists to guarantee — exactly one sender per
 * row, failures recorded rather than thrown, a backoff that keeps a just-failed row out of the next
 * pass, a lease that releases a dead worker's row, a row that stops being tried after MAX_ATTEMPTS,
 * and a success that leaves a `MailMessage` row a test can assert on. The worker code is already
 * written; this file is its contract.
 *
 * `now` is a controlled clock and `random` is pinned, so the backoff arithmetic is exact rather
 * than jittered: with `random() === 0.5` the ±20% jitter factor is exactly 1.
 */

const ORIGIN = 'https://app.example.test';
const FROM = 'OneResi <no-reply@oneresi.test>';
const TO = 'priya@oneresi.local';
const CONFIGURATION_SET = 'oneresi-mail';

let db: Db;
let nowMs: number;
const clock = (): Date => new Date(nowMs);
const quiet = collectingLogger();

/** A lease that expired a comfortably long time ago. */
const DEFAULT_LEASE_PAST_MS = 10 * 60_000;

function anInvoiceJob(to = TO): string {
  return encodeMailJob({
    to: { email: to, name: 'Priya Menon' },
    template: 'invoice.raised',
    vars: {
      recipientName: 'Priya Menon',
      home: 'Block A · A-101',
      invoiceId: 204,
      period: '2026-09',
      amountPaise: 480_000,
      dueOn: '2026-09-15',
    },
  });
}

interface RowOverrides {
  readonly type?: string;
  readonly payload?: string;
  readonly attempts?: number;
  readonly availableAt?: Date;
  readonly status?: string;
}

async function aPendingRow(overrides: RowOverrides = {}): Promise<number> {
  const row = await db.outboxEvent.create({
    data: {
      type: 'invoice.raised',
      channel: 'EMAIL',
      payload: anInvoiceJob(),
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

function aSesProvider(recording: ReturnType<typeof recordingSesClient>) {
  return createSesProvider({
    client: recording.client,
    configurationSetName: CONFIGURATION_SET,
  });
}

function drain(
  provider: Parameters<typeof drainOutbox>[0]['provider'],
  extra: Partial<Parameters<typeof drainOutbox>[0]> = {},
): Promise<DrainReport> {
  return drainOutbox({
    db,
    provider,
    origin: ORIGIN,
    now: clock,
    random: () => 0.5,
    logger: quiet.logger,
    ...extra,
  });
}

const originalFrom = process.env.MAIL_FROM;

beforeAll(async () => {
  const opened = await testDatabase();
  db = opened.db;
  setMailTestDatabase(db);
  // `deliver()` reads the sending identity from the environment; pin it so the from address on
  // every row below is this test's, not whatever the machine happens to say.
  process.env.MAIL_FROM = FROM;
  nowMs = Date.parse('2026-09-08T10:00:00.000Z');
});

afterAll(() => {
  if (originalFrom === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = originalFrom;
  resetMailTesting();
});

// Each test drains against an empty table, so a report's counts and the matcher's "found N" mean
// exactly what the test says, not what an earlier test left behind.
beforeEach(async () => {
  await db.mailMessage.deleteMany();
  await db.outboxEvent.deleteMany();
});

describe('the success path', () => {
  it('sends the row, records the message, and marks both rows', async () => {
    const id = await aPendingRow();
    const recording = recordingSesClient();

    const report = await drain(aSesProvider(recording));

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

    // The transport saw one command, addressed and configured as this stack requires (D-30).
    expect(recording.sent).toHaveLength(1);
    const input = recording.sent[0];
    expect(input.FromEmailAddress).toBe(FROM);
    expect(input.Destination).toEqual({ ToAddresses: [TO] });
    expect(input.ConfigurationSetName).toBe(CONFIGURATION_SET);
    expect(input.EmailTags).toContainEqual({ Name: 'correlation', Value: 'corr-test' });

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toBeNull();
    expect(outbox.sentAt).toEqual(clock());

    // The history row: what the mail suite and the mail log read (D-31).
    const mail = await db.mailMessage.findUniqueOrThrow({ where: { outboxEventId: id } });
    expect(mail.provider).toBe('ses');
    expect(mail.providerMessageId).toBe('ses-test-1');
    expect(mail.template).toBe('invoice.raised');
    expect(mail.toAddress).toBe(TO);
    expect(mail.fromAddress).toBe(FROM);
    expect(mail.subject).toBe('Maintenance for September 2026');
    expect(mail.bodyText).toContain(`${ORIGIN}/a/dues/204`);
    expect(mail.bodyText).toContain('₹4,800.00');
    expect(mail.bodyHtml).toContain(`${ORIGIN}/a/dues/204`);
    expect(mail.status).toBe('SENT');
    expect(mail.sentAt).not.toBeNull();
    expect(JSON.parse(mail.variables)).toMatchObject({
      amount: '₹4,800.00',
      dueDate: '15 Sep 2026',
    });

    // And the matcher agrees, end to end.
    await expectMail()
      .to(TO)
      .withTemplate('invoice.raised')
      .withSubject(/Maintenance for September/)
      .withVars({ amount: '₹4,800.00', dueDate: '15 Sep 2026' })
      .toHaveBeenSentOnce();
    await expectMail().toHaveNoUnsent();
  });
});

describe('the claim', () => {
  it('lets exactly one of two workers send a row', async () => {
    const id = await aPendingRow();
    const workerA = recordingSesClient({ messageIdPrefix: 'a' });
    const workerB = recordingSesClient({ messageIdPrefix: 'b' });

    // Both drains read the same row before either claims it — that is the race the conditional
    // update exists for. Whichever way the engine interleaves them, one claim matches the row's
    // attempt count and the other matches nothing.
    const [a, b] = await Promise.all([
      drain(aSesProvider(workerA)),
      drain(aSesProvider(workerB)),
    ]);

    expect(a.sent + b.sent).toBe(1);
    expect(a.claimed + b.claimed).toBe(1);
    expect([...workerA.sent, ...workerB.sent]).toHaveLength(1);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.attempts).toBe(1);
    await expectMail().to(TO).toHaveBeenSentTimes(1);
  });
});

describe('a failing provider', () => {
  it('records the failure on both rows and does not throw', async () => {
    const id = await aPendingRow();
    const provider = failingProvider({ message: 'The provider is unavailable' });

    // The whole point of the outbox: the drain returns a report rather than raising, so a billing
    // run cannot fail because mail is down (D-29).
    const report = await drain(provider);
    expect(report).toMatchObject({ considered: 1, claimed: 1, sent: 0, retried: 1 });
    expect(report.problems).toEqual([]);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('PENDING');
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toContain('The provider is unavailable');
    // Pinned random, so the jitter factor is exactly 1: the retry is one full backoff away.
    expect(outbox.availableAt).toEqual(new Date(nowMs + backoffMs(1)));

    const mail = await db.mailMessage.findUniqueOrThrow({ where: { outboxEventId: id } });
    expect(mail.status).toBe('FAILED');
    expect(mail.error).toContain('The provider is unavailable');

    // The matcher refuses to call a failed message sent, and says so in those words.
    await expect(expectMail().to(TO).toHaveBeenSentOnce()).rejects.toThrow(/has not gone out/);
  });

  it('is not retried immediately, and is retried after the backoff', async () => {
    const id = await aPendingRow();

    await drain(failingProvider({ message: 'The provider is unavailable' }));

    // A second pass, at the same moment: nothing is due.
    const immediate = await drain(aSesProvider(recordingSesClient()));
    expect(immediate.considered).toBe(0);
    const untouched = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(untouched.attempts).toBe(1);

    // One backoff later (plus a millisecond), the row is due again and this time it goes out.
    nowMs += backoffMs(1) + 1;
    const retry = await drain(aSesProvider(recordingSesClient()));
    expect(retry).toMatchObject({ considered: 1, claimed: 1, sent: 1, lost: 0 });

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.attempts).toBe(2);

    // The retry updated the one mail row it already had, because the tie is unique.
    expect(await db.mailMessage.count({ where: { outboxEventId: id } })).toBe(1);
  });
});

describe('a claim whose lease has expired', () => {
  it('is re-claimable, having spent one attempt', async () => {
    // The state a worker that died mid-send leaves behind: still PENDING, one attempt spent, the
    // lease (`availableAt`) now in the past. The conservative direction — a message that crashes
    // the process cannot spin forever, because the crashed attempt was counted.
    const id = await aPendingRow({
      attempts: 1,
      availableAt: new Date(nowMs - DEFAULT_LEASE_PAST_MS),
    });

    const report = await drain(aSesProvider(recordingSesClient()));
    expect(report).toMatchObject({ considered: 1, claimed: 1, sent: 1 });

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('SENT');
    expect(outbox.attempts).toBe(2);
  });
});

describe('MAX_ATTEMPTS', () => {
  it('leaves the row FAILED for a person, permanently', async () => {
    const id = await aPendingRow({ attempts: MAX_ATTEMPTS - 1 });

    const report = await drain(failingProvider({ message: 'Still unavailable' }));
    expect(report).toMatchObject({ sent: 0, retried: 0, failed: 1 });
    expect(report.problems[0]).toMatch(/failed after 5 attempts and is waiting for someone/);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('FAILED');
    expect(outbox.attempts).toBe(MAX_ATTEMPTS);
    expect(outbox.lastError).toContain('Still unavailable');

    // A later drain does not pick it up again, even with a healthy provider.
    const later = await drain(aSesProvider(recordingSesClient()));
    expect(later.considered).toBe(0);
    expect(await db.outboxEvent.count({ where: { id, status: 'FAILED' } })).toBe(1);

    await expect(expectMail().toHaveNoUnsent()).rejects.toThrow(/outbox #\d+/);
  });
});

describe('a permanent failure', () => {
  it('is abandoned on the first attempt', async () => {
    const id = await aPendingRow();
    const provider = failingProvider({
      message: 'Address suppressed by the provider',
      permanent: true,
    });

    const report = await drain(provider);
    expect(report).toMatchObject({ sent: 0, retried: 0, failed: 0, abandoned: 1 });
    expect(report.problems[0]).toMatch(/abandoned on attempt 1/);

    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(outbox.status).toBe('ABANDONED');
    expect(outbox.attempts).toBe(1);
    expect(outbox.lastError).toContain('Address suppressed by the provider');
  });
});

describe('rows that are not this worker\'s', () => {
  it('never touches another channel', async () => {
    await db.outboxEvent.create({
      data: {
        type: 'visitor.arrived',
        channel: 'PUSH',
        payload: anInvoiceJob(),
        status: 'PENDING',
        availableAt: clock(),
        correlationId: 'corr-test',
      },
    });

    const report = await drain(aSesProvider(recordingSesClient()));
    expect(report.considered).toBe(0);
    expect(await db.outboxEvent.count({ where: { channel: 'PUSH', status: 'PENDING' } })).toBe(1);
  });
});
