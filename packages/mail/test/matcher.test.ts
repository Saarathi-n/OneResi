import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@oneresi/db';
import { MailAssertionError } from '../src/errors.js';
import { expectMail, resetMailTesting, setMailTestDatabase } from '../src/testing.js';
import { testDatabase } from '../../../test/helpers/database.js';

/**
 * Tier 1's other half (docs/plan/05-testing.md): `expectMail()`.
 *
 * The assertions are not the point of this file — a passing matcher is easy. The point is the failure
 * path: a failed expectation must carry what is actually in the table, so the next person reading a
 * red run knows what happened without opening a SQL prompt. Every `rejects.toThrow` below checks the
 * words the matcher actually writes.
 *
 * Rows are written directly here (not through the worker) because this file tests the matcher's own
 * optics, not the pipeline; the worker tests cover the end-to-end chain. Each test starts from empty
 * tables so a "nothing was sent" assertion means exactly that.
 */

const TO = 'priya@oneresi.local';
const FROM = 'OneResi <no-reply@oneresi.test>';
const SUBJECT = 'Maintenance for September 2026';
const VARIABLES = JSON.stringify({
  name: 'Priya Menon',
  unit: 'Block A · A-101',
  period: 'September 2026',
  amount: '₹4,800.00',
  dueDate: '15 Sep 2026',
});

let db: Db;

interface MailOverrides {
  readonly toAddress?: string;
  readonly template?: string;
  readonly subject?: string;
  readonly variables?: string;
  readonly status?: string;
  readonly provider?: string;
  readonly error?: string | null;
  readonly outboxEventId?: number;
}

async function aMailRow(overrides: MailOverrides = {}): Promise<number> {
  const { outboxEventId, ...rest } = overrides;
  const row = await db.mailMessage.create({
    data: {
      provider: 'ses',
      template: 'invoice.raised',
      toAddress: TO,
      fromAddress: FROM,
      subject: SUBJECT,
      bodyText: 'Your maintenance bill for September 2026 is ready.',
      bodyHtml: '<p>Your maintenance bill for September 2026 is ready.</p>',
      variables: VARIABLES,
      status: 'SENT',
      ...rest,
      ...(outboxEventId === undefined ? {} : { outboxEventId }),
    },
    select: { id: true },
  });
  return row.id;
}

/** An outbox row in a chosen state, for the whole-table assertion and the empty-table diagnostics. */
async function anOutboxRow(
  overrides: {
    readonly status?: string;
    readonly attempts?: number;
    readonly lastError?: string;
  } = {},
): Promise<number> {
  const row = await db.outboxEvent.create({
    data: {
      type: 'invoice.raised',
      channel: 'EMAIL',
      payload: '{}',
      status: 'PENDING',
      attempts: 0,
      availableAt: new Date('2026-09-08T10:00:00.000Z'),
      correlationId: 'corr-test',
      ...overrides,
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  const opened = await testDatabase();
  db = opened.db;
  setMailTestDatabase(db);
});

beforeEach(async () => {
  await db.mailMessage.deleteMany();
  await db.outboxEvent.deleteMany();
});

afterAll(() => {
  resetMailTesting();
});

describe('a passing expectation', () => {
  it('returns the row through the full chain', async () => {
    const id = await aMailRow();

    const row = await expectMail()
      .to('  Priya@Oneresi.Local  ')
      .withTemplate('invoice.raised')
      .withSubject(/Maintenance for September/)
      .withSubject('Maintenance')
      .withVars({ amount: '₹4,800.00' })
      .withProvider('ses')
      .toHaveBeenSentOnce();

    expect(row.id).toBe(id);
    expect(row.status).toBe('SENT');
    expect(row.variables).toMatchObject({ amount: '₹4,800.00', dueDate: '15 Sep 2026' });
  });

  it('compares variables given as numbers as strings, because that is how they are recorded', async () => {
    await db.mailMessage.create({
      data: {
        provider: 'console',
        template: 'password.reset_requested',
        toAddress: TO,
        fromAddress: FROM,
        subject: 'Reset your password',
        bodyText: 'A link to choose a new password.',
        bodyHtml: '<p>A link to choose a new password.</p>',
        variables: JSON.stringify({ minutes: '30' }),
        status: 'SENT',
      },
      select: { id: true },
    });

    await expectMail()
      .to(TO)
      .withTemplate('password.reset_requested')
      .withVars({ minutes: 30 })
      .toHaveBeenSentOnce();
  });

  it('counts and negates', async () => {
    await aMailRow();
    await aMailRow();

    await expectMail().to(TO).toHaveBeenSentTimes(2);
    await expectMail().to('someone.else@oneresi.local').toHaveNeverBeenSent();
  });

  it('reads the database it was handed, without a configured one', async () => {
    resetMailTesting();
    const id = await aMailRow();
    const row = await expectMail(db).to(TO).toHaveBeenSentOnce();
    expect(row.id).toBe(id);
    setMailTestDatabase(db);
  });
});

describe('a failed expectation', () => {
  it('names what is in the table, and why each row did not match', async () => {
    await aMailRow({ subject: 'Maintenance for October 2026' });

    await expect(
      expectMail().to(TO).withSubject(/Maintenance for September/).toHaveBeenSentOnce(),
    ).rejects.toThrow(
      /What is in the table:\s+#\d+ to priya@oneresi\.local · invoice\.raised · "Maintenance for October 2026" · SENT — subject was "Maintenance for October 2026"/,
    );
  });

  it('reports a variable that differs and one that is absent', async () => {
    await aMailRow();

    await expect(
      expectMail().to(TO).withVars({ amount: '₹4,799.00' }).toHaveBeenSentOnce(),
    ).rejects.toThrow(/variable "amount" was "₹4,800\.00", expected "₹4,799\.00"/);

    await expect(
      expectMail().to(TO).withVars({ reference: 'TXN-91' }).toHaveBeenSentOnce(),
    ).rejects.toThrow(/variable "reference" was absent, expected "TXN-91"/);
  });

  it('reports which provider actually ran', async () => {
    await aMailRow({ provider: 'console' });

    await expect(expectMail().to(TO).withProvider('ses').toHaveBeenSentOnce()).rejects.toThrow(
      /provider was "console"/,
    );
  });

  it('lists the table when the recipient was never mailed', async () => {
    await aMailRow();

    await expect(
      expectMail().to('someone.else@oneresi.local').toHaveBeenSentOnce(),
    ).rejects.toThrow(/found 0\.\s+What is in the table:\s+#\d+ to priya@oneresi\.local/);
  });

  it('counts two when exactly one was wanted', async () => {
    await aMailRow();
    await aMailRow();

    await expect(expectMail().to(TO).toHaveBeenSentOnce()).rejects.toThrow(
      /Expected exactly one message with to priya@oneresi\.local, found 2/,
    );
  });

  it('refuses to call an unsent message sent', async () => {
    await aMailRow({ status: 'FAILED', error: 'SES refused the message: throttled' });

    await expect(expectMail().to(TO).toHaveBeenSentOnce()).rejects.toThrow(
      /The message exists but has not gone out: #\d+ to priya@oneresi\.local · invoice\.raised · "Maintenance for September 2026" · FAILED · SES refused the message: throttled/,
    );
  });

  it('says the worker has not run when only outbox rows exist', async () => {
    await anOutboxRow({ status: 'PENDING' });
    await anOutboxRow({ status: 'PENDING' });

    await expect(expectMail().to(TO).toHaveBeenSentOnce()).rejects.toThrow(
      /Nothing has been sent, but 2 email outbox row\(s\) are waiting\. The worker has to run/,
    );
  });

  it('says the use case wrote nothing when the tables are empty', async () => {
    await expect(expectMail().to(TO).toHaveBeenSentOnce()).rejects.toThrow(
      /Nothing has been sent, and there are no email outbox rows either, so the use case never wrote one/,
    );
  });
});

describe('toHaveNoUnsent', () => {
  it('passes when every email row has gone out', async () => {
    const outboxId = await anOutboxRow({ status: 'SENT' });
    await aMailRow({ outboxEventId: outboxId });

    await expectMail().toHaveNoUnsent();
  });

  it('lists the stuck outbox row and the unsent mail row', async () => {
    const stuck = await anOutboxRow({
      status: 'PENDING',
      attempts: 2,
      lastError: 'MailDeliveryError: The provider is unavailable',
    });
    await aMailRow({ outboxEventId: stuck, status: 'FAILED', error: 'throttled' });

    await expect(expectMail().toHaveNoUnsent()).rejects.toThrow(
      new RegExp(
        [
          'Mail is still waiting or has failed:',
          `  outbox #${stuck} invoice\\.raised · PENDING · 2 attempt\\(s\\) · MailDeliveryError: The provider is unavailable`,
          '#\\d+ to priya@oneresi\\.local · invoice\\.raised · "Maintenance for September 2026" · FAILED · throttled',
        ].join('\\s+'),
      ),
    );
  });

  it('is a whole-table assertion and says so when filtered', async () => {
    await expect(expectMail().to(TO).toHaveNoUnsent()).rejects.toThrow(/whole-table assertion/);
  });
});

describe('the escape hatch', () => {
  it('rows() returns everything matching, before any sent-ness judgement', async () => {
    await aMailRow();
    await aMailRow({ status: 'FAILED' });
    await aMailRow({ toAddress: 'someone.else@oneresi.local' });

    const rows = await expectMail().to(TO).withTemplate('invoice.raised').rows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['SENT', 'FAILED']));
  });
});

describe('the error type', () => {
  it('is a MailAssertionError, so a runner can tell a matcher failure from a bug', async () => {
    await aMailRow();
    try {
      await expectMail().to('someone.else@oneresi.local').toHaveBeenSentOnce();
      expect.unreachable('the expectation should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MailAssertionError);
    }
  });
});
