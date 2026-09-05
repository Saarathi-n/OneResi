import { randomBytes } from 'node:crypto';
import {
  consoleLogger,
  type Logger,
  type MailProvider,
  type SendRequest,
  type SendResult,
} from '../types.js';

/**
 * The local provider.
 *
 * There is no external system, so delivery is the `MailMessage` row `deliver()` writes plus one line
 * on the console saying what went where. The row is the part that matters: mail history lives in the
 * database, which is why a test can assert on it and why the committee's mail log survives a restart.
 * The previous build appended to `.dev_emails.json` inside the container, so history was per-task,
 * vanished on every deploy, and lost writes whenever two requests overlapped (D-31).
 *
 * It is not selectable in production. `mailDriver()` refuses anything but `ses` there, because a
 * provider that reports success without sending is exactly how the previous build "sent" mail on AWS
 * with no AWS SDK installed (D-30).
 */

export interface ConsoleProviderOptions {
  readonly logger?: Logger;
}

/** Its own id, so the column is populated whichever provider ran and a log line is greppable. */
function localMessageId(): string {
  return `local-${randomBytes(8).toString('hex')}`;
}

export function createConsoleProvider(options: ConsoleProviderOptions = {}): MailProvider {
  const logger = options.logger ?? consoleLogger;

  return {
    name: 'console',
    send: (request: SendRequest): Promise<SendResult> => {
      const providerMessageId = localMessageId();
      logger.info(
        `mail → ${request.to} · ${request.template} · "${request.subject}" · ` +
          `${providerMessageId} · correlation=${request.correlationId}`,
      );
      return Promise.resolve({ providerMessageId });
    },
  };
}
