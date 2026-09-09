import type { PushRequest, PushResult, PushTransport } from './ports.js';

/**
 * The dev transport, mirroring the mail package's console provider: no web-push, no VAPID key,
 * no network. Delivery is one console line saying what would have gone where, so a local run of
 * the push path is visible end to end without a single external system.
 *
 * It always reports delivered — a provider that reports success without sending is a lie in
 * production (that is exactly how the previous build "sent" mail on AWS with no AWS SDK
 * installed, D-30), so the real wiring must never select this transport there.
 */

/** The logger the transport takes. The same two methods the mail package's Logger keeps. */
export interface PushLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * The default logger. The console transport's delivery line is the one honest use of `console`
 * in this package, exactly as the mail package's `consoleLogger` argues for its own two lines.
 */
export const consolePushLogger: PushLogger = {
  info: (message) => {
    // eslint-disable-next-line no-console -- the whole point of this logger
    console.info(message);
  },
  warn: (message) => {
    // eslint-disable-next-line no-console -- the whole point of this logger
    console.warn(message);
  },
};

export interface ConsolePushTransportOptions {
  readonly logger?: PushLogger;
}

export function createConsolePushTransport(
  options: ConsolePushTransportOptions = {},
): PushTransport {
  const logger = options.logger ?? consolePushLogger;

  return {
    name: 'console',
    send: (request: PushRequest): Promise<PushResult> => {
      logger.info(
        `push → ${request.subscription.endpoint} · "${request.title}" · ` +
          `correlation=${request.correlationId}`,
      );
      return Promise.resolve({ delivered: true, gone: false });
    },
  };
}
