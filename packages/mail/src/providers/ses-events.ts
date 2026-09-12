import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { Db } from '@grihaone/db';
import { sesEventQueueUrl } from '../env.js';

/**
 * What SES says happened after it took the message.
 *
 * The configuration set publishes SEND, DELIVERY, BOUNCE, COMPLAINT and REJECT to SNS, which feeds an
 * SQS queue (docs/plan/03). Draining that queue is the only way to know a message left AWS rather than
 * merely being accepted, which is what the third tier of the mail suite asserts, and it is where
 * `MailMessage.deliveryState` comes from.
 */

export const SES_EVENT_RANK: Readonly<Record<string, number>> = {
  SEND: 1,
  DELIVERY_DELAY: 2,
  DELIVERY: 3,
  COMPLAINT: 4,
  REJECT: 5,
  RENDERING_FAILURE: 5,
  BOUNCE: 6,
};

export interface SesEvent {
  /** `DELIVERY`, `BOUNCE`, … Anything unrecognised comes through as given, upper cased. */
  readonly type: string;
  readonly providerMessageId: string | null;
  readonly recipients: readonly string[];
  readonly subject: string | null;
  /** A bounce subtype, a complaint feedback type — whatever the event carries as its reason. */
  readonly detail: string | null;
  readonly receiptHandle: string | null;
}

export interface RawMessage {
  readonly body: string;
  readonly receiptHandle: string | null;
}

/** Two operations, so a test double is two functions and the AWS client stays out of the seam. */
export interface SesEventTransport {
  receive(maxMessages: number, waitSeconds: number): Promise<readonly RawMessage[]>;
  remove(receiptHandles: readonly string[]): Promise<void>;
}

/** The two fields of an SQS message this reader uses, named structurally so the shape is visible. */
interface SqsMessageLike {
  readonly Body?: string | undefined;
  readonly ReceiptHandle?: string | undefined;
}

export function sqsTransport(options: { queueUrl?: string; region?: string } = {}): SesEventTransport {
  const queueUrl = options.queueUrl ?? sesEventQueueUrl();
  const client = new SQSClient(options.region === undefined ? {} : { region: options.region });

  return {
    receive: async (maxMessages, waitSeconds) => {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
          WaitTimeSeconds: Math.min(Math.max(waitSeconds, 0), 20),
        }),
      );
      return (response.Messages ?? []).map((message: SqsMessageLike) => ({
        body: message.Body ?? '',
        receiptHandle: message.ReceiptHandle ?? null,
      }));
    },
    remove: async (receiptHandles) => {
      for (let index = 0; index < receiptHandles.length; index += 10) {
        const batch = receiptHandles.slice(index, index + 10);
        await client.send(
          new DeleteMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: batch.map((handle, position) => ({
              Id: `d${index + position}`,
              ReceiptHandle: handle,
            })),
          }),
        );
      }
    },
  };
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Handles both an SNS envelope and raw message delivery, because either is a valid subscription. */
export function decodeSesEvent(message: RawMessage): SesEvent | null {
  let parsed = asRecord(safeParse(message.body));
  if (parsed === null) return null;

  const inner = readString(parsed, 'Message');
  if (parsed['Type'] === 'Notification' && inner !== null) {
    const unwrapped = asRecord(safeParse(inner));
    if (unwrapped === null) return null;
    parsed = unwrapped;
  }

  const rawType = readString(parsed, 'eventType') ?? readString(parsed, 'notificationType');
  if (rawType === null) return null;

  const mail = asRecord(parsed['mail']);
  const headers = mail === null ? null : asRecord(mail['commonHeaders']);
  const destination = mail === null ? undefined : mail['destination'];

  const bounce = asRecord(parsed['bounce']);
  const complaint = asRecord(parsed['complaint']);

  return {
    type: rawType.trim().toUpperCase().replace(/\s+/g, '_'),
    providerMessageId: mail === null ? null : readString(mail, 'messageId'),
    recipients: Array.isArray(destination)
      ? destination.filter((entry): entry is string => typeof entry === 'string')
      : [],
    subject: headers === null ? null : readString(headers, 'subject'),
    detail:
      bounce !== null
        ? [readString(bounce, 'bounceType'), readString(bounce, 'bounceSubType')]
            .filter((part): part is string => part !== null)
            .join(' / ') || null
        : complaint !== null
          ? readString(complaint, 'complaintFeedbackType')
          : null,
    receiptHandle: message.receiptHandle,
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface ReadSesEventsOptions {
  readonly transport?: SesEventTransport;
  readonly maxMessages?: number;
  readonly waitSeconds?: number;
  /** Leave the messages on the queue. The default deletes them, so the next run starts clean. */
  readonly keep?: boolean;
}

/** One receive. Long polls by default, which is how SQS is meant to be read. */
export async function readSesEvents(
  options: ReadSesEventsOptions = {},
): Promise<readonly SesEvent[]> {
  const transport = options.transport ?? sqsTransport();
  const messages = await transport.receive(options.maxMessages ?? 10, options.waitSeconds ?? 20);

  const events: SesEvent[] = [];
  const handles: string[] = [];
  for (const message of messages) {
    const event = decodeSesEvent(message);
    if (event !== null) events.push(event);
    // An undecodable message is still removed: leaving it makes it a permanent poison message.
    if (message.receiptHandle !== null) handles.push(message.receiptHandle);
  }

  if (options.keep !== true && handles.length > 0) await transport.remove(handles);
  return events;
}

/** Events that mean the message did not arrive. A complaint arrived and was unwelcome, which differs. */
const HARD_FAILURES: readonly string[] = ['BOUNCE', 'REJECT', 'RENDERING_FAILURE'];

/**
 * Writes what SES said onto the rows. Later events never lose to earlier ones, and a negative outcome
 * is never masked by a positive one that arrives out of order — a bounce has to stay visible.
 */
export async function applySesEvents(db: Db, events: readonly SesEvent[]): Promise<number> {
  let applied = 0;

  for (const event of events) {
    if (event.providerMessageId === null) continue;
    const rank = SES_EVENT_RANK[event.type] ?? 0;
    if (rank === 0) continue;

    const row = await db.mailMessage.findFirst({
      where: { providerMessageId: event.providerMessageId },
      orderBy: { id: 'desc' },
      select: { id: true, deliveryState: true, outboxEventId: true },
    });
    if (row === null) continue;

    const current = row.deliveryState === null ? 0 : (SES_EVENT_RANK[row.deliveryState] ?? 0);
    if (rank < current) continue;

    const hard = HARD_FAILURES.includes(event.type);
    const reason = event.detail === null ? event.type : `${event.type}: ${event.detail}`;

    await db.mailMessage.update({
      where: { id: row.id },
      data: hard
        ? { deliveryState: event.type, status: 'FAILED', error: reason }
        : { deliveryState: event.type },
      select: { id: true },
    });

    // The outbox row is marked too, so a bounce is visible where the send was recorded (05).
    if (hard && row.outboxEventId !== null) {
      await db.outboxEvent.updateMany({
        where: { id: row.outboxEventId },
        data: { status: 'FAILED', lastError: reason },
      });
    }

    applied += 1;
  }

  return applied;
}

export async function drainSesEvents(
  options: ReadSesEventsOptions & { readonly db: Db },
): Promise<{ readonly events: readonly SesEvent[]; readonly applied: number }> {
  const events = await readSesEvents(options);
  return { events, applied: await applySesEvents(options.db, events) };
}

export interface PollSesEventsOptions extends ReadSesEventsOptions {
  /** Stops early when the events so far are enough. The live suite waits for SEND then DELIVERY. */
  readonly until?: (events: readonly SesEvent[]) => boolean;
  readonly timeoutMs?: number;
}

/** Reads until `until` is satisfied or the budget runs out. Returns everything it saw either way. */
export async function pollSesEvents(
  options: PollSesEventsOptions = {},
): Promise<readonly SesEvent[]> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const seen: SesEvent[] = [];

  while (Date.now() < deadline) {
    const remainingSeconds = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    const batch = await readSesEvents({
      ...options,
      waitSeconds: Math.min(options.waitSeconds ?? 20, remainingSeconds),
    });
    seen.push(...batch);

    if (options.until !== undefined && options.until(seen)) break;
    if (batch.length > 0) continue;
    // A transport that answers instantly — a double, or a queue with long polling off — would
    // otherwise spin here for the whole budget.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return seen;
}
