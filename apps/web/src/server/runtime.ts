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
} from '@oneresi/db';
import {
  accountsService,
  visitorsService,
  billingService,
  complaintsService,
  facilitiesService,
  noticesService,
  notificationsService,
  propertyService,
  bcryptHasher,
  joseAccessToken,
  type Clock,
  type ServiceEnv,
} from '@oneresi/domain';
import { startMailWorker, type MailWorkerHandle } from '@oneresi/mail/worker';
import { BCRYPT_COST } from '@oneresi/contracts';

/**
 * The composition root (docs/plan/02-architecture.md). One module constructs the Prisma client,
 * every store adapter, and every service from packages/domain/src/ports.ts — a route handler
 * receives a wired service and never reaches around this seam.
 *
 * This file is the ONLY place in apps/web that imports @oneresi/db; the eslint layering rule
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
  const holder = globalThis as { __oneresiDevJwtSecret?: Uint8Array };
  holder.__oneresiDevJwtSecret ??= new Uint8Array(randomBytes(32));
  return holder.__oneresiDevJwtSecret;
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
}

let shutdownRegistered = false;

/** Stops the local mail worker (if running) and closes the single Prisma client. */
async function shutdown(): Promise<void> {
  const pending = (globalThis as { __oneresiWebRuntime?: Promise<{ mailWorker: MailWorkerHandle | null }> })
    .__oneresiWebRuntime;
  if (pending === undefined) return;
  const rt = await pending.catch(() => null);
  await rt?.mailWorker?.stop();
  await closeDb();
}

async function buildRuntime(): Promise<Runtime & { mailWorker: MailWorkerHandle | null }> {
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
    notifications: notificationsService({ store: notificationsStore(db), clock }),
    property: propertyService({ store: propertyStore(db) }),
    mailWorker,
  };
}

const holder = globalThis as {
  __oneresiWebRuntime?: Promise<Runtime & { mailWorker: MailWorkerHandle | null }>;
};

/** Every service, wired. Memoized on globalThis so a dev-server hot reload reuses the same client. */
export function services(): Promise<Runtime & { mailWorker: MailWorkerHandle | null }> {
  holder.__oneresiWebRuntime ??= buildRuntime();
  return holder.__oneresiWebRuntime;
}
