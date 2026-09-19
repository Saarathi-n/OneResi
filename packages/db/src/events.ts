import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

/**
 * The cloud halves of the outbox: waking the Lambda that drains it, and opening the database it
 * drains from. Both are AWS transports, which is why they live in the db package — the one layer
 * that already owns "where do the rows live" — and both are no-ops locally, where the in-process
 * timers and the SQLite file do the same jobs.
 */

// ---------------------------------------------------------------- the wake-up

/**
 * Publishes one message to the domain-events topic per outbox write, when `EVENT_DRIVER=sns`.
 *
 * The message is a wake-up, not a work item: the notifier Lambda it triggers drains every due row
 * in all three channels, so the payload only names what woke it for the log. One message per
 * write rather than per row keeps a billing run for forty-six units to one publish.
 *
 * Called from inside the transaction's callback, so it can fire for a row that never commits —
 * the drain that wakes finds nothing due and costs a no-op — and it never throws: a transaction
 * must not fail because SNS hiccuped. A lost publish is healed by the next one, and by the
 * schedule that wakes the notifier every few minutes regardless.
 */
export async function announceEvents(events: readonly { type: string }[]): Promise<void> {
  if (process.env['EVENT_DRIVER'] !== 'sns') return;
  const topicArn = process.env['SNS_TOPIC_ARN'];
  if (topicArn === undefined || topicArn === '') return;
  if (events.length === 0) return;

  try {
    const sns = new SNSClient({});
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'outbox',
        Message: JSON.stringify({
          wake: 'outbox-write',
          events: events.map((event) => event.type),
        }),
      }),
    );
  } catch (cause) {
    // The one honest use of console in this package: a Lambda-adjacent transport with no logger
    // seam to hand, and a silent lost wake-up is the alternative.
    // eslint-disable-next-line no-console -- see the comment above
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'outbox wake-up publish failed; the schedule will drain regardless',
        detail: String(cause),
      }),
    );
  }
}

// ---------------------------------------------------------------- the database URL

/**
 * Builds `DATABASE_URL` from the parts Terraform sets for the Lambdas — the same assembly the
 * app container's entrypoint does in shell. Fetches the password from Secrets Manager under the
 * one ARN the role can read, so the credential never rides an environment variable.
 *
 * Returns null when the parts are absent (local, or a container whose entrypoint already set
 * DATABASE_URL) — the caller leaves the environment alone in that case.
 */
export async function cloudDatabaseUrlFromParts(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (env['DATABASE_URL'] !== undefined && env['DATABASE_URL'] !== '') return null;
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_SECRET_ARN } = env;
  if (DB_HOST === undefined || DB_USER === undefined || DB_SECRET_ARN === undefined) return null;

  const secrets = new SecretsManagerClient({});
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const password = (JSON.parse(secret.SecretString ?? '{}') as { password?: string }).password;
  if (password === undefined) {
    throw new Error('The database secret has no password key.');
  }

  const encode = (value: string): string => encodeURIComponent(value);
  return (
    `postgresql://${encode(DB_USER)}:${encode(password)}@${DB_HOST}` +
    `:${DB_PORT ?? '5432'}/${DB_NAME ?? 'grihaone'}?sslmode=${env['DB_SSLMODE'] ?? 'require'}`
  );
}
