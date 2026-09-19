import { randomBytes } from 'node:crypto';
import {
  getDb,
  closeDb,
  assertRuntimeConfig,
  accountStore,
  visitorStore,
  propertyStore,
  billingStore,
  complaintStore,
  facilitiesStore,
  noticesStore,
  notificationsStore,
  rateLimiter,
} from '@grihaone/db';
import {
  accountsService,
  visitorsService,
  billingService,
  complaintsService,
  facilitiesService,
  noticesService,
  notificationsService,
  propertyService,
  reportsService,
  bcryptHasher,
  createConsolePushTransport,
  inAppNotification,
  joseAccessToken,
  type Clock,
  type PushTransport,
  type ServiceEnv,
} from '@grihaone/domain';
import { startMailWorker, type MailWorkerHandle } from '@grihaone/mail/worker';
import { startPushWorker, type PushWorkerHandle } from '@grihaone/mail/push-worker';
import { startInAppWorker, type InAppWorkerHandle } from '@grihaone/mail/in-app-worker';
import { createWebPushTransport } from '@grihaone/mail/providers/webpush';
import { pushDriver } from '@grihaone/mail';
import { BCRYPT_COST } from '@grihaone/contracts';

/**
 * The composition root (docs/plan/02-architecture.md). One module constructs the Prisma client,
 * every store adapter, and every service from packages/domain/src/ports.ts — a route handler
 * receives a wired service and never reaches around this seam.
 *
 * This file is the ONLY place in apps/web that imports @grihaone/db; the eslint layering rule
 * keeps route handlers off it, and everything they use flows through here.
 */

/** The wall clock. Tests of the services inject their own; this one is the real hand. */
const clock: Clock = { now: (): Date => new Date() };

/**
 * The dev-only signing secret fallback. Random per process and cached on globalThis so a
 * hot-reload does not invalidate every token mid-session. In production there is no fallback —
 * `assertRuntimeConfig()` (below) refuses to boot without a real JWT_SECRET, because a defaulted
 * secret is a forged-token vulnerability that looks like a working app (D-05).
 */
function devJwtSecret(): Uint8Array {
  const holder = globalThis as { __grihaoneDevJwtSecret?: Uint8Array };
  holder.__grihaoneDevJwtSecret ??= new Uint8Array(randomBytes(32));
  return holder.__grihaoneDevJwtSecret;
}

function jwtSecret(): Uint8Array {
  const fromEnv = process.env['JWT_SECRET'];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return new Uint8Array(Buffer.from(fromEnv, 'utf8'));
  }
  // assertRuntimeConfig() has already thrown in production by the time this runs.
  return devJwtSecret();
}

interface Runtime {
  readonly accounts: ReturnType<typeof accountsService>;
  readonly visitors: ReturnType<typeof visitorsService>;
  readonly billing: ReturnType<typeof billingService>;
  readonly complaints: ReturnType<typeof complaintsService>;
  readonly facilities: ReturnType<typeof facilitiesService>;
  readonly notices: ReturnType<typeof noticesService>;
  readonly notifications: ReturnType<typeof notificationsService>;
  readonly property: ReturnType<typeof propertyService>;
  readonly reports: ReturnType<typeof reportsService>;
}

let shutdownRegistered = false;

/** Stops the local workers (if running) and closes the single Prisma client. */
async function shutdown(): Promise<void> {
  const pending = (globalThis as { __grihaoneWebRuntime?: Promise<BuiltRuntime> })
    .__grihaoneWebRuntime;
  if (pending === undefined) return;
  const rt = await pending.catch(() => null);
  await rt?.mailWorker?.stop();
  await rt?.pushWorker?.stop();
  await rt?.inAppWorker?.stop();
  await closeDb();
}

/** What the composition root hands the composition seams: a full runtime plus its local workers. */
interface BuiltRuntime extends Runtime {
  readonly mailWorker: MailWorkerHandle | null;
  readonly pushWorker: PushWorkerHandle | null;
  readonly inAppWorker: InAppWorkerHandle | null;
  /**
   * The push transport selected by PUSH_DRIVER, exported for the Lambda, which drains the PUSH
   * channel in the same invocation as email and needs the same object rather than a second one
   * constructed from the same variables.
   */
  readonly pushTransport: PushTransport;
}

/**
 * The transport the notifications service sends through, by PUSH_DRIVER. `pushDriver()` refuses
 * anything but webpush in production and `createWebPushTransport()` resolves the VAPID settings
 * eagerly — so a production misconfiguration dies HERE, at boot, loudly, exactly the way a
 * defaulted one silently delivering nothing must not (D-30, and D-05's argument for it).
 */
function selectPushTransport(): PushTransport {
  const driver = pushDriver();
  return driver === 'webpush' ? createWebPushTransport() : createConsolePushTransport();
}

async function buildRuntime(): Promise<BuiltRuntime> {
  // Production misconfiguration fails HERE, at boot, loudly — never as a silent fallback.
  assertRuntimeConfig();

  const env: ServiceEnv = { clock, jwtSecret: jwtSecret() };
  const db = await getDb();

  const limiter = rateLimiter(db);
  const accounts = accountsService({
    store: accountStore(db),
    limiter,
    hasher: bcryptHasher(BCRYPT_COST),
    tokens: joseAccessToken(env.jwtSecret, clock),
    env,
  });

  const mailWorker =
    process.env.NODE_ENV === 'production'
      ? null // Production drains the outbox from SQS → Lambda, never an in-process timer.
      : startMailWorker();

  const pushTransport = selectPushTransport();
  const notifications = notificationsService({
    store: notificationsStore(db),
    clock,
    push: pushTransport,
  });

  // The local push drain runs beside the mail drain on the same interval, in the same process:
  // locally the three channels are one process's three timers. On AWS none of these timers
  // exists — the Lambda's handler drains every channel once per invocation.
  const pushWorker =
    process.env.NODE_ENV === 'production'
      ? null
      : startPushWorker({
          // The dispatcher is a callback, not an import: packages/mail must not depend on
          // packages/domain (WIRING's layering), so the composition root supplies the function
          // the drain calls per row. Structural typing carries it across the seam.
          dispatch: (userId, event) => notifications.dispatchPush({ userId, event }),
        });

  // The in-app drain, wired the same way: the domain's wording function and the notifications
  // store's insert, both supplied here because packages/mail cannot import either.
  const inAppWorker =
    process.env.NODE_ENV === 'production'
      ? null
      : startInAppWorker({
          wording: inAppNotification,
          sink: (userId, wording) =>
            notificationsStore(db)
              .createNotifications([
                { userId, type: wording.type, title: wording.title, body: wording.body, href: wording.href, createdAt: clock.now() },
              ])
              .then(() => undefined),
        });

  if (!shutdownRegistered) {
    shutdownRegistered = true;
    process.once('SIGTERM', () => {
      void shutdown();
    });
    process.once('SIGINT', () => {
      void shutdown();
    });
  }

  return {
    accounts,
    visitors: visitorsService({ store: visitorStore(db), limiter, clock }),
    billing: billingService({ store: billingStore(db), clock }),
    complaints: complaintsService({ store: complaintStore(db), clock }),
    facilities: facilitiesService({ store: facilitiesStore(db), clock }),
    notices: noticesService({ store: noticesStore(db), clock }),
    notifications,
    property: propertyService({ store: propertyStore(db) }),
    reports: reportsService({
      billing: billingStore(db),
      complaints: complaintStore(db),
      visitors: visitorStore(db),
      facilities: facilitiesStore(db),
      clock,
    }),
    mailWorker,
    pushWorker,
    inAppWorker,
    pushTransport,
  };
}

const holder = globalThis as { __grihaoneWebRuntime?: Promise<BuiltRuntime> };

/** Every service, wired. Memoized on globalThis so a dev-server hot reload reuses the same client. */
export function services(): Promise<BuiltRuntime> {
  holder.__grihaoneWebRuntime ??= buildRuntime().catch((err) => {
    delete holder.__grihaoneWebRuntime;
    throw err;
  });
  return holder.__grihaoneWebRuntime;
}
