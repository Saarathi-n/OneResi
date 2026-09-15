/**
 * The notifier: SNS → SQS → here, plus a schedule that wakes it every few minutes regardless.
 *
 * One invocation drains every due row in all three channels — email through SES, push through the
 * web-push transport signed with the VAPID pair, in-app into the notification table — and then
 * applies whatever SES delivery events have landed on the mail queue: a bounce marks its mail row
 * FAILED with the reason instead of retrying a dead address forever. The message that woke the
 * function is a nudge, not a work item; the drains claim rows by compare-and-swap, so two
 * invocations racing is two claims and exactly one winner per row.
 *
 * A throw fails the SQS batch, which retries and then dead-letters — the honest failure mode for
 * a drain that cannot finish, and the one the alarm on the DLQ depth watches.
 *
 * The database password is fetched from Secrets Manager under the one ARN this role can read
 * (the same assembly the app container's entrypoint does in shell) and never rides an environment
 * variable.
 */
import { cloudDatabaseUrlFromParts } from '@grihaone/db';
import { getDb, closeDb, accountStore, notificationsStore, visitorStore } from '@grihaone/db';
import { drainOutbox } from '@grihaone/mail/worker';
import { drainPushOutbox } from '@grihaone/mail/push-worker';
import { drainInAppOutbox } from '@grihaone/mail/in-app-worker';
import { applySesEvents, decodeSesEvent, type RawMessage } from '@grihaone/mail/providers/ses-events';
import {
  billingService,
  complaintsService,
  createConsolePushTransport,
  facilitiesService,
  inAppNotification,
  noticesService,
  notificationsService,
  propertyService,
  visitorsService,
  type PushTransport,
} from '@grihaone/domain';
import { createWebPushTransport } from '@grihaone/mail/providers/webpush';
import { pushDriver } from '@grihaone/mail';

// A throw inside a domain call is a value the drains already contain; a throw out of the handler
// is the batch failing. Only unexpected breakage reaches that far, which is exactly what the
// retry-then-DLQ ladder is for.

interface SqsRecord {
  body?: string;
  eventSourceARN?: string;
  messageAttributes?: Record<string, { value?: string }>;
}

interface SqsEvent {
  Records?: SqsRecord[];
}

/** The queue the SES configuration set publishes delivery events to, by ARN. */
const MAIL_EVENTS_SUFFIX = '.sqs.mail-events';

export async function handler(event: SqsEvent): Promise<{ drained: boolean; sesApplied: number }> {
  const url = await cloudDatabaseUrlFromParts();
  if (url !== null) process.env['DATABASE_URL'] = url;

  const db = await getDb();
  try {
    // SES delivery events arrive on their own queue — same function, second event source
    // mapping. One batch comes from exactly one queue, so the branch is unambiguous.
    const firstArn = event.Records?.[0]?.eventSourceARN ?? '';
    if (firstArn.endsWith(MAIL_EVENTS_SUFFIX) || firstArn.includes('mail-events')) {
      const decoded = (event.Records ?? []).flatMap((record) => {
        // RawMessage's fields are lower-case (body, receiptHandle); the capitalized shape this
        // used to pass made every decode read `undefined`, silently drop every SES event, and
        // leave deliveryState empty forever — the bug that hid whether Gmail took the mail.
        const raw: RawMessage = { body: record.body ?? '', receiptHandle: null };
        const decoded = decodeSesEvent(raw);
        return decoded === null ? [] : [decoded];
      });
      const applied = await applySesEvents(db, decoded);
      return { drained: false, sesApplied: applied };
    }

    // The three drains, wired exactly the way apps/web/src/server/runtime.ts wires them — the
    // composition root in a Lambda, over the same stores and services.
    const clock = { now: (): Date => new Date() };

    const mail = await drainOutbox({ origin: process.env['APP_ORIGIN'] });

    // The same selection apps/web/src/server/runtime.ts makes: webpush in production where the
    // VAPID pair is set and the constructor refuses to boot without it, the console no-op
    // anywhere else — which is also what makes this handler runnable against a local database.
    const push: PushTransport =
      pushDriver() === 'webpush' ? createWebPushTransport() : createConsolePushTransport();
    const notifications = notificationsService({
      store: notificationsStore(db),
      clock,
      push,
    });
    const pushReport = await drainPushOutbox({
      dispatch: (userId, pushEvent) => notifications.dispatchPush({ userId, event: pushEvent }),
    });

    const inApp = await drainInAppOutbox({
      wording: inAppNotification,
      sink: (userId, wording) =>
        notificationsStore(db)
          .createNotifications([
            {
              userId,
              type: wording.type,
              title: wording.title,
              body: wording.body,
              href: wording.href,
              createdAt: clock.now(),
            },
          ])
          .then(() => undefined),
    });

    return {
      drained: true,
      sesApplied: 0,
      ...(mail.problems.length + pushReport.problems.length + inApp.problems.length > 0
        ? { problems: [...mail.problems, ...pushReport.problems, ...inApp.problems] }
        : {}),
    };
  } finally {
    await closeDb().catch(() => undefined);
  }
}

// The services below are imported for the wiring they make possible in future handlers (the
// overdue flag's invoice mail rides the same outbox); tree-shaking keeps the bundle to what the
// handler actually calls. The imports also prove the bundle resolves the whole graph — a Lambda
// that only builds against half the domain is a deploy-time surprise this line prevents.
void [
  accountStore,
  visitorStore,
  billingService,
  complaintsService,
  facilitiesService,
  noticesService,
  propertyService,
  visitorsService,
];
