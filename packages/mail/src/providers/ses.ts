import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { MailDeliveryError } from '../errors.js';
import { sesConfigurationSet, sesRegion } from '../env.js';
import type { MailProvider, SendRequest, SendResult } from '../types.js';

/**
 * The real one.
 *
 * `SESv2Client.send`, with the configuration set whose event destination publishes SEND, DELIVERY,
 * BOUNCE, COMPLAINT and REJECT to SNS and then SQS — which is the only way anything downstream can
 * assert that a message actually left AWS (docs/plan/03, 05). The provider message id SES returns is
 * recorded on the `MailMessage` row, and it is what those events are matched back by.
 *
 * The provider it replaces wrote a console line, appended to a JSON file, and reported success, with
 * no `@aws-sdk/*` package anywhere in the dependency list — so switching drivers in production would
 * silently have dropped every message (D-30). This file has one job and it makes one API call.
 */

/** Narrow on purpose: the message id is all this provider needs back. A test double is one function. */
export interface SesClientLike {
  send(command: SendEmailCommand): Promise<{ readonly MessageId?: string | undefined }>;
}

export interface SesProviderOptions {
  /** A recording double in tests; the real client, built lazily from the environment, otherwise. */
  readonly client?: SesClientLike;
  readonly region?: string;
  readonly configurationSetName?: string;
}

/** SES message tags take letters, digits, hyphens and underscores only. `invoice.raised` would 400. */
function tagSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

/**
 * A rejected message is rejected for good — a suppressed address, content SES will not carry. Anything
 * else (throttling, a paused account, a missing configuration set, no network) is somebody's to fix,
 * so the row keeps its attempts and comes back.
 */
const PERMANENT_FAILURES: readonly string[] = ['MessageRejected', 'BadRequestException'];

export function createSesProvider(options: SesProviderOptions = {}): MailProvider {
  let cachedClient: SesClientLike | undefined = options.client;
  let cachedSetName: string | undefined = options.configurationSetName;

  /** Lazy: constructing a client at import time would fail a build and hide a missing variable. */
  function resolve(): { client: SesClientLike; configurationSetName: string } {
    // Read one at a time, so a test that injects a client and a set name needs no AWS environment.
    const configurationSetName = cachedSetName ?? sesConfigurationSet();
    cachedSetName = configurationSetName;

    const client =
      cachedClient ??
      ((): SesClientLike => {
        const real = new SESv2Client({ region: options.region ?? sesRegion() });
        return { send: (command) => real.send(command) };
      })();
    cachedClient = client;

    return { client, configurationSetName };
  }

  return {
    name: 'ses',
    send: async (request: SendRequest): Promise<SendResult> => {
      const resolved = resolve();

      const command = new SendEmailCommand({
        FromEmailAddress: request.from,
        // One recipient. No Cc, no Bcc, anywhere in this package (D-29).
        Destination: { ToAddresses: [request.to] },
        ConfigurationSetName: resolved.configurationSetName,
        Content: {
          Simple: {
            Subject: { Data: request.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: request.text, Charset: 'UTF-8' },
              Html: { Data: request.html, Charset: 'UTF-8' },
            },
          },
        },
        EmailTags: [
          { Name: 'template', Value: tagSafe(request.template) },
          { Name: 'correlation', Value: tagSafe(request.correlationId) },
        ],
      });

      let messageId: string | undefined;
      try {
        const response = await resolved.client.send(command);
        messageId = response.MessageId;
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : 'UnknownError';
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new MailDeliveryError(`SES refused the message: ${detail}`, {
          permanent: PERMANENT_FAILURES.includes(name),
          providerCode: name,
          cause,
        });
      }

      if (messageId === undefined || messageId === '') {
        throw new MailDeliveryError('SES accepted the request but returned no message id', {
          providerCode: 'NoMessageId',
        });
      }
      return { providerMessageId: messageId };
    },
  };
}
