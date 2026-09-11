import { MailConfigError } from './errors.js';
import type { MailDriver } from './types.js';

/**
 * Every environment variable this package reads, read lazily, with no fallbacks that could hide a
 * misconfiguration.
 *
 * Nothing here runs at import time. The previous build called `mkdirSync` while a module loaded,
 * which fails on a read-only filesystem and during a build (D-31), and fell back to a committed
 * secret when a variable was absent, which is how a deployed container ended up signing sessions
 * with a value from the repository (D-05). A missing variable is an error with a sentence saying
 * what to set.
 */

type Env = NodeJS.ProcessEnv;

function required(env: Env, key: string, why: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new MailConfigError(`${key} is not set. ${why}`);
  }
  return value.trim();
}

/**
 * The origin every link in every message is built from. No default, in any environment: a link is
 * either correct for where the app is actually running or it is a support ticket. Six templates in
 * the previous build hardcoded `http://localhost:3000`, so a deployed build emailed residents an
 * address on their own machine (D-22, D-29).
 */
export function appOrigin(env: Env = process.env): string {
  const raw = required(
    env,
    'APP_ORIGIN',
    'Every link in an email is built from it. Set it to the origin the app is served from, ' +
      'for example https://app.oneresi.in — there is no fallback.',
  );

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new MailConfigError(`APP_ORIGIN is not a URL: "${raw}"`, { cause });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new MailConfigError(`APP_ORIGIN must be http or https, received "${parsed.protocol}"`);
  }
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new MailConfigError('APP_ORIGIN must be https in production.');
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new MailConfigError(
      `APP_ORIGIN is an origin, not a page: expected something like ${parsed.origin}`,
    );
  }
  return parsed.origin;
}

/**
 * Which provider delivers. Production must say `ses` explicitly — an unset variable that quietly
 * selected a provider which only writes a log line is exactly how the previous build managed to
 * "send" mail on AWS without an AWS SDK installed (D-30, D-06).
 */
export function mailDriver(env: Env = process.env): MailDriver {
  const requested = env.EMAIL_DRIVER?.trim().toLowerCase();

  if (env.NODE_ENV === 'production') {
    if (requested !== 'ses') {
      throw new MailConfigError(
        'EMAIL_DRIVER must be "ses" in production. The console provider writes a row and a log ' +
          'line and delivers nothing, so defaulting to it in production would drop every message.',
      );
    }
    return 'ses';
  }

  if (requested === undefined || requested === '') return 'console';
  if (requested === 'console' || requested === 'ses') return requested;
  throw new MailConfigError(`EMAIL_DRIVER must be "console" or "ses", received "${requested}"`);
}

/** Reserved by RFC 6762, so a stray local send cannot reach a real mailbox. */
const LOCAL_FROM = 'OneResi <no-reply@oneresi.local>';

/**
 * The sending identity. Required whenever mail really leaves the machine, because SES rejects an
 * unverified sender and a guessed default would fail every send in one indistinguishable way.
 */
export function mailFrom(env: Env = process.env): string {
  const raw = env.MAIL_FROM?.trim();

  if (raw === undefined || raw === '') {
    if (mailDriver(env) === 'ses') {
      throw new MailConfigError(
        'MAIL_FROM is not set. It has to be an address verified in SES for this region, in ' +
          '"Name <address>" form or bare.',
      );
    }
    return LOCAL_FROM;
  }
  if (!raw.includes('@')) {
    throw new MailConfigError(`MAIL_FROM does not look like an address: "${raw}"`);
  }
  return raw;
}

export interface SesSettings {
  readonly region: string;
  /**
   * The configuration set is not decoration: its event destination is what publishes SEND,
   * DELIVERY, BOUNCE, COMPLAINT and REJECT to SNS and then SQS, which is the only way anything can
   * assert that a message actually left AWS (docs/plan/03, 05).
   */
  readonly configurationSetName: string;
  readonly fromAddress: string;
}

/**
 * `AWS_REGION` is set for us inside Fargate and Lambda; `AWS_DEFAULT_REGION` is what the CLI
 * profile uses locally. Neither is guessed: a laptop defaulting to us-east-1 while everything else
 * targets ap-south-1 is how an identity gets verified in the wrong region (D-78).
 */
export function sesRegion(env: Env = process.env): string {
  const value = (env.AWS_REGION ?? env.AWS_DEFAULT_REGION)?.trim();
  if (value === undefined || value === '') {
    throw new MailConfigError(
      'AWS_REGION is not set. SES identities are per region, so an identity verified in another ' +
        'region cannot send here.',
    );
  }
  return value;
}

export function sesConfigurationSet(env: Env = process.env): string {
  return required(
    env,
    'SES_CONFIGURATION_SET',
    'Terraform creates it, and its event destination is what the mail suite reads.',
  );
}

/** All three at once, for a health check or the dev console. Each is also readable on its own. */
export function sesSettings(env: Env = process.env): SesSettings {
  return {
    region: sesRegion(env),
    configurationSetName: sesConfigurationSet(env),
    fromAddress: mailFrom(env),
  };
}

/** The queue SES delivery events land in, via SNS. Read by the event reader only. */
export function sesEventQueueUrl(env: Env = process.env): string {
  return required(
    env,
    'SES_EVENT_QUEUE_URL',
    'It is an output of the mail stack; the live mail suite drains it.',
  );
}

// ---------------------------------------------------------------- push

/** Which transport delivers push. `webpush` is the real one; `console` is the dev no-op. */
export type PushDriver = 'console' | 'webpush';

/**
 * Which transport delivers push. The same rule `mailDriver` keeps, for the same reason: a
 * production default that quietly selected the console transport would report every
 * notification as delivered while sending nothing — exactly how the previous build "sent" mail
 * on AWS with no AWS SDK installed (D-30).
 */
export function pushDriver(env: Env = process.env): PushDriver {
  const requested = env.PUSH_DRIVER?.trim().toLowerCase();

  if (env.NODE_ENV === 'production') {
    if (requested !== 'webpush') {
      throw new MailConfigError(
        'PUSH_DRIVER must be "webpush" in production. The console transport writes a log line ' +
          'and delivers nothing, so defaulting to it in production would drop every notification.',
      );
    }
    return 'webpush';
  }

  if (requested === undefined || requested === '') return 'console';
  if (requested === 'console' || requested === 'webpush') return requested;
  throw new MailConfigError(`PUSH_DRIVER must be "console" or "webpush", received "${requested}"`);
}

/** The VAPID keypair plus the contact the push service complains to. All three, or none. */
export interface VapidSettings {
  /**
   * A `mailto:` address. The push service uses it to reach the sender about deliverability —
   * the VAPID spec's "who is responsible for this traffic" field, and a bare keypair cannot
   * stand in for it.
   */
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

/**
 * The application server's VAPID identity. Required whenever push really leaves the machine:
 * a push service refuses a message signed with no keypair, and a guessed default would fail
 * every send in one indistinguishable way (the same argument `mailFrom` keeps for SES).
 *
 * Generate once with `pnpm push:keys`, keep the pair together, and reuse it forever — a
 * rotated keypair retires every browser's subscription.
 */
export function vapidSettings(env: Env = process.env): VapidSettings {
  const subject = required(
    env,
    'VAPID_SUBJECT',
    'A mailto: address for the push service to reach you on, e.g. mailto:admin@oneresi.in. ' +
      'Generate the keypair with: pnpm push:keys',
  );
  if (!subject.startsWith('mailto:')) {
    throw new MailConfigError(`VAPID_SUBJECT must be a mailto: address, received "${subject}"`);
  }

  return {
    subject,
    publicKey: required(
      env,
      'VAPID_PUBLIC_KEY',
      'The public half of the push keypair, base64url. Generate once with: pnpm push:keys',
    ),
    privateKey: required(
      env,
      'VAPID_PRIVATE_KEY',
      'The private half of the push keypair, base64url. Generate once with: pnpm push:keys',
    ),
  };
}

/**
 * The public key a browser needs to subscribe, or null when push is not configured. This never
 * throws: it is the one read that runs on a request path (the key route), where the answer to a
 * misconfiguration is an honest "not configured" the client can render — the boot-time eager
 * construction of the webpush transport is where a production misconfiguration refuses to start.
 */
export function pushPublicKey(env: Env = process.env): string | null {
  try {
    if (pushDriver(env) !== 'webpush') return null;
    return vapidSettings(env).publicKey;
  } catch {
    return null;
  }
}
