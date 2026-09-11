/**
 * Placeholder notifier.
 *
 * The real handler comes from the monorepo and shares `packages/domain` and `packages/db`, so the
 * notification rules exist once rather than being reimplemented here. Point
 * `notifier_bundle_dir` at the built bundle and Terraform deploys that instead of this file.
 *
 * Until then this fails on purpose. A placeholder that returned normally would acknowledge messages it
 * had not delivered, which is exactly the silent-drop behaviour the outbox pipeline exists to prevent:
 * the message would leave the queue, no mail would be sent, and nothing would show it. Failing sends
 * the message back for three attempts, then to the dead letter queue, where the alarm on queue depth
 * says so out loud.
 *
 * What the real handler is given, all set by Terraform (see events.tf):
 *
 *   DB_TARGET=cloud, DB_HOST, DB_PORT, DB_NAME, DB_USER   connection parts
 *   DB_SECRET_ARN                                         the password lives here, never in an env var
 *   APP_ORIGIN                                            for absolute links in mail
 *   EMAIL_DRIVER=ses, SES_CONFIGURATION_SET               naming the configuration set is what makes
 *                                                         delivery events reach the mail test suite
 *   MAIL_FROM                                             the identity this role may send as. Spelled
 *                                                         the way packages/mail reads it
 *   SES_EVENT_QUEUE_URL                                   where those delivery events land
 *   NOTIFICATIONS_QUEUE_URL                               the queue this function drains
 *   PUSH_DRIVER=webpush, VAPID_PUBLIC_KEY, VAPID_SUBJECT,
 *   VAPID_PRIVATE_KEY                                     the push half of the same invocation. The
 *                                                         handler drains channel='PUSH' outbox rows
 *                                                         through the same claim/lease/retry lifecycle
 *                                                         as the mail rows (packages/mail reuses one
 *                                                         set of constants, not two), resolving each
 *                                                         row's email to an account and dispatching
 *                                                         through the notifications service, which
 *                                                         signs each send with the VAPID pair. No
 *                                                         extra IAM: a browser's push service is just
 *                                                         another HTTPS endpoint, reached over the
 *                                                         same IPv6 egress path as SES
 *   AWS_USE_DUALSTACK_ENDPOINT=true                       the function is in private subnets with no
 *                                                         IPv4 route out; AWS APIs are reached over
 *                                                         IPv6 through the egress-only gateway
 *
 * The role allows exactly: receive and delete on that one queue, SendEmail as that one identity,
 * GetSecretValue on that one secret, and the KMS key that decrypts it.
 */
export async function handler(event) {
  const count = event?.Records?.length ?? 0;

  console.error(
    JSON.stringify({
      level: 'error',
      message: 'notifier bundle not deployed; refusing to acknowledge messages',
      records: count,
    }),
  );

  throw new Error(
    `The notifier placeholder cannot deliver ${count} message(s). Build the monorepo bundle and set ` +
      'notifier_bundle_dir, then apply. Nothing has been acknowledged, so no notification is lost.',
  );
}
