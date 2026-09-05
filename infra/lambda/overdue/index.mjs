/**
 * Placeholder overdue-flag job.
 *
 * EventBridge Scheduler invokes this at 00:30 Asia/Kolkata. The real handler comes from the monorepo so
 * the overdue rule lives in `packages/domain` beside every other rule; point `overdue_bundle_dir` at
 * the built bundle and Terraform deploys that instead of this file.
 *
 * The rule it replaces was `POST /api/cron/overdue`: no session check, no shared secret, no source
 * restriction, nothing scheduling it, and off by one — `due_date < now` against a column holding
 * midnight flagged an invoice as overdue at 00:01 on its own due date (D-36). The correct comparison is
 * "due date is strictly before today in the society's timezone", which is why SOCIETY_TIMEZONE is set
 * rather than assumed.
 *
 * Environment, all from Terraform (see events.tf): DB_TARGET=cloud, DB_HOST, DB_PORT, DB_NAME,
 * DB_USER, DB_SECRET_ARN, SOCIETY_TIMEZONE, AWS_USE_DUALSTACK_ENDPOINT. The role can read that one
 * secret and decrypt it, and nothing else — no SES, no SQS, no S3.
 */
export async function handler(event) {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'overdue-flag bundle not deployed; no invoice was examined',
      trigger: event?.source ?? 'unknown',
    }),
  );

  throw new Error(
    'The overdue-flag placeholder did not evaluate any invoice. Build the monorepo bundle and set ' +
      'overdue_bundle_dir, then apply. Failing loudly here is better than a nightly job that reports ' +
      'success without flagging anything.',
  );
}
