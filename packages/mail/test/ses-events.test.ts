import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@grihaone/db';
import {
  applySesEvents,
  decodeSesEvent,
  readSesEvents,
  type RawMessage,
  type SesEventTransport,
} from '../src/providers/ses-events.js';
import { resetMailTesting, setMailTestDatabase } from '../src/testing.js';
import { testDatabase } from '../../../test/helpers/database.js';

/**
 * The decode half of tier 3's plumbing (docs/plan/05-testing.md): SES publishes SEND, DELIVERY,
 * BOUNCE, COMPLAINT and REJECT to SNS and then SQS, in either a raw or an SNS-wrapped message body,
 * and these tests pin what the decoder reads out of both shapes. The `applySesEvents` half is
 * asserted against a real database, because the state machine (a bounce is never masked by a
 * delivery that arrives out of order) is exactly the kind of thing that only shows up on rows.
 *
 * The fixtures follow the SES event publishing JSON: `eventType`/`notificationType` on top, the
 * `mail` section carrying `messageId`, `destination` and `commonHeaders.subject`, and a `bounce` or
 * `complaint` section carrying the reason.
 */

const FROM = 'no-reply@grihaone.test';
const PROBE = 'probe@example.com';
const SUBJECT = 'GrihaOne delivery probe ABC123';
const MESSAGE_ID = '0100018c8f3d2a1b-2c3d4e5f-000000';

function sesEventBody(
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventType: type,
    mail: {
      timestamp: '2026-09-08T10:00:00.000Z',
      source: FROM,
      messageId: MESSAGE_ID,
      destination: [PROBE],
      commonHeaders: { from: [FROM], to: [PROBE], subject: SUBJECT },
    },
    ...extra,
  };
}

function raw(body: unknown, receiptHandle = 'rh-raw'): RawMessage {
  return { body: JSON.stringify(body), receiptHandle };
}

/** What SNS actually delivers: the event JSON as a string inside a Notification. */
function snsWrapped(body: unknown, receiptHandle = 'rh-sns'): RawMessage {
  return {
    body: JSON.stringify({
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: 'arn:aws:sns:ap-south-1:000000000000:mail-events',
      Message: JSON.stringify(body),
    }),
    receiptHandle,
  };
}

describe('decodeSesEvent', () => {
  it('reads a SEND: the id, the destination, the subject, the handle', () => {
    const event = decodeSesEvent(raw(sesEventBody('Send')));
    expect(event).toEqual({
      type: 'SEND',
      providerMessageId: MESSAGE_ID,
      recipients: [PROBE],
      subject: SUBJECT,
      detail: null,
      receiptHandle: 'rh-raw',
    });
  });

  it('reads a DELIVERY', () => {
    const event = decodeSesEvent(
      raw(sesEventBody('Delivery', { delivery: { recipients: [PROBE], smtpResponse: '250 2.0.0 OK' } })),
    );
    expect(event?.type).toBe('DELIVERY');
    expect(event?.providerMessageId).toBe(MESSAGE_ID);
  });

  it('reads a BOUNCE with its reason as the detail', () => {
    const event = decodeSesEvent(
      raw(
        sesEventBody('Bounce', {
          bounce: {
            bounceType: 'Permanent',
            bounceSubType: 'General',
            bouncedRecipients: [{ emailAddress: PROBE, diagnosticCode: 'smtp; 550 5.1.1' }],
          },
        }),
      ),
    );
    expect(event?.type).toBe('BOUNCE');
    expect(event?.detail).toBe('Permanent / General');
  });

  it('reads a COMPLAINT with its feedback type', () => {
    const event = decodeSesEvent(
      raw(
        sesEventBody('Complaint', {
          complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: PROBE }] },
        }),
      ),
    );
    expect(event?.type).toBe('COMPLAINT');
    expect(event?.detail).toBe('abuse');
  });

  it('reads a REJECT, which carries no reason section', () => {
    const event = decodeSesEvent(raw(sesEventBody('Reject')));
    expect(event?.type).toBe('REJECT');
    expect(event?.detail).toBeNull();
  });

  it('unwraps the SNS envelope, which is the shape SQS actually receives', () => {
    const event = decodeSesEvent(snsWrapped(sesEventBody('Send')));
    expect(event).toMatchObject({ type: 'SEND', providerMessageId: MESSAGE_ID, subject: SUBJECT });
    expect(event?.receiptHandle).toBe('rh-sns');
  });

  it('unwraps a bounce inside an SNS envelope too', () => {
    const event = decodeSesEvent(
      snsWrapped(
        sesEventBody('Bounce', { bounce: { bounceType: 'Transient', bounceSubType: 'Mailbox full' } }),
      ),
    );
    expect(event).toMatchObject({ type: 'BOUNCE', detail: 'Transient / Mailbox full' });
  });

  it('reads the older notificationType spelling as well', () => {
    const event = decodeSesEvent(
      raw({
        notificationType: 'Bounce',
        mail: { messageId: MESSAGE_ID, destination: [PROBE], commonHeaders: { subject: SUBJECT } },
        bounce: { bounceType: 'Permanent', bounceSubType: 'Suppressed' },
      }),
    );
    expect(event).toMatchObject({ type: 'BOUNCE', detail: 'Permanent / Suppressed' });
  });

  it('returns null for anything it cannot read', () => {
    expect(decodeSesEvent({ body: 'not json', receiptHandle: null })).toBeNull();
    expect(decodeSesEvent({ body: '[]', receiptHandle: null })).toBeNull();
    expect(decodeSesEvent({ body: '{}', receiptHandle: null })).toBeNull(); // no event type
    expect(decodeSesEvent({ body: '"a string"', receiptHandle: null })).toBeNull();
    // An SNS envelope whose inner message is not the event JSON.
    expect(
      decodeSesEvent({ body: JSON.stringify({ Type: 'Notification', Message: 'nope' }), receiptHandle: null }),
    ).toBeNull();
  });
});

describe('readSesEvents', () => {
  function aTransport(messages: readonly RawMessage[]): {
    readonly transport: SesEventTransport;
    readonly removed: string[];
  } {
    const removed: string[] = [];
    return {
      transport: {
        receive: async () => messages,
        remove: async (handles) => {
          removed.push(...handles);
        },
      },
      removed,
    };
  }

  it('decodes the batch and removes what it read, so the next run starts clean', async () => {
    const { transport, removed } = aTransport([
      raw(sesEventBody('Send'), 'rh-1'),
      { body: 'garbage', receiptHandle: 'rh-2' },
      raw(sesEventBody('Delivery'), 'rh-3'),
    ]);

    const events = await readSesEvents({ transport });

    expect(events.map((event) => event.type)).toEqual(['SEND', 'DELIVERY']);
    // The undecodable message is removed too: leaving it would make it a permanent poison message.
    expect(removed).toEqual(['rh-1', 'rh-2', 'rh-3']);
  });

  it('leaves the messages on the queue when asked', async () => {
    const { transport, removed } = aTransport([raw(sesEventBody('Send'), 'rh-1')]);
    await readSesEvents({ transport, keep: true });
    expect(removed).toEqual([]);
  });
});

describe('applySesEvents', () => {
  let db: Db;

  /** A message that went out: SENT outbox row, SENT mail row carrying the provider message id. */
  async function aSentMessage(providerMessageId = MESSAGE_ID): Promise<void> {
    const outbox = await db.outboxEvent.create({
      data: {
        type: 'announcement.published',
        channel: 'EMAIL',
        payload: '{}',
        status: 'SENT',
        attempts: 1,
        availableAt: new Date('2026-09-08T10:00:00.000Z'),
        sentAt: new Date('2026-09-08T10:00:05.000Z'),
        correlationId: 'corr-test',
      },
      select: { id: true },
    });
    await db.mailMessage.create({
      data: {
        outboxEventId: outbox.id,
        provider: 'ses',
        providerMessageId,
        template: 'announcement.published',
        toAddress: PROBE,
        fromAddress: FROM,
        subject: SUBJECT,
        bodyText: 'A delivery probe for the mail suite.',
        bodyHtml: '<p>A delivery probe for the mail suite.</p>',
        variables: '{}',
        status: 'SENT',
        sentAt: new Date('2026-09-08T10:00:05.000Z'),
      },
      select: { id: true },
    });
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

  it('walks a delivered message from SEND to DELIVERY without touching its status', async () => {
    await aSentMessage();

    expect(await applySesEvents(db, [decodeSesEvent(raw(sesEventBody('Send')))])).toBe(1);
    let mail = await db.mailMessage.findFirstOrThrow({ where: { providerMessageId: MESSAGE_ID } });
    expect(mail.deliveryState).toBe('SEND');
    expect(mail.status).toBe('SENT');

    expect(await applySesEvents(db, [decodeSesEvent(raw(sesEventBody('Delivery')))])).toBe(1);
    mail = await db.mailMessage.findFirstOrThrow({ where: { providerMessageId: MESSAGE_ID } });
    expect(mail.deliveryState).toBe('DELIVERY');
    expect(mail.status).toBe('SENT');
    expect(mail.error).toBeNull();
  });

  it('marks a bounce on both rows: mail FAILED with the reason, outbox FAILED', async () => {
    await aSentMessage();

    const applied = await applySesEvents(db, [
      decodeSesEvent(
        raw(sesEventBody('Bounce', { bounce: { bounceType: 'Permanent', bounceSubType: 'General' } })),
      ),
    ]);
    expect(applied).toBe(1);

    const mail = await db.mailMessage.findFirstOrThrow({ where: { providerMessageId: MESSAGE_ID } });
    expect(mail.deliveryState).toBe('BOUNCE');
    expect(mail.status).toBe('FAILED');
    expect(mail.error).toBe('BOUNCE: Permanent / General');

    const outbox = await db.outboxEvent.findFirstOrThrow({
      where: { mail: { providerMessageId: MESSAGE_ID } },
    });
    expect(outbox.status).toBe('FAILED');
    expect(outbox.lastError).toBe('BOUNCE: Permanent / General');
  });

  it('never lets a late DELIVERY mask a bounce', async () => {
    await aSentMessage();

    await applySesEvents(db, [
      decodeSesEvent(raw(sesEventBody('Bounce', { bounce: { bounceType: 'Permanent' } }))),
    ]);
    const applied = await applySesEvents(db, [decodeSesEvent(raw(sesEventBody('Delivery')))]);

    expect(applied).toBe(0);
    const mail = await db.mailMessage.findFirstOrThrow({ where: { providerMessageId: MESSAGE_ID } });
    expect(mail.deliveryState).toBe('BOUNCE');
    expect(mail.status).toBe('FAILED');
  });

  it('records a complaint without marking the message failed: it arrived, unwelcome', async () => {
    await aSentMessage();

    const applied = await applySesEvents(db, [
      decodeSesEvent(
        raw(sesEventBody('Complaint', { complaint: { complaintFeedbackType: 'abuse' } })),
      ),
    ]);
    expect(applied).toBe(1);

    const mail = await db.mailMessage.findFirstOrThrow({ where: { providerMessageId: MESSAGE_ID } });
    expect(mail.deliveryState).toBe('COMPLAINT');
    expect(mail.status).toBe('SENT');
    const outbox = await db.outboxEvent.findFirstOrThrow({
      where: { mail: { providerMessageId: MESSAGE_ID } },
    });
    expect(outbox.status).toBe('SENT');
  });

  it('skips events for messages it does not know and events without a message id', async () => {
    await aSentMessage();

    const otherMessage = decodeSesEvent(
      raw({
        eventType: 'Send',
        mail: { messageId: 'someone-elses-id', destination: ['x@example.com'], commonHeaders: { subject: 'x' } },
      }),
    );
    expect(await applySesEvents(db, [otherMessage])).toBe(0);

    const noId = { ...decodeSesEvent(raw(sesEventBody('Send'))), providerMessageId: null };
    expect(await applySesEvents(db, [noId])).toBe(0);

    const unknownType = { ...decodeSesEvent(raw(sesEventBody('Send'))), type: 'OPEN' };
    expect(await applySesEvents(db, [unknownType])).toBe(0);
  });

  afterAll(() => {
    resetMailTesting();
  });
});
