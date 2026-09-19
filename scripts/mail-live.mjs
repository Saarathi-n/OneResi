#!/usr/bin/env node
/**
 * Tier 3 of the mail suite (docs/plan/05-testing.md): the message actually left AWS.
 *
 * Sends one message to a verified probe address with a unique token in the subject, then reads the
 * SQS queue the configuration set publishes to, and asserts:
 *
 *   1. a SEND event carrying the token,
 *   2. a DELIVERY event carrying the token, after the SEND,
 *   3. no BOUNCE, COMPLAINT or REJECT for it,
 *   4. and the queue is drained, so the next run starts clean.
 *
 * Opt-in on purpose: it sends one real email and needs the deployed stack. Everything it needs
 * comes from the environment, which is to say from the stack outputs
 * (`terraform -chdir=infra/stack output`):
 *
 *   AWS_REGION or AWS_DEFAULT_REGION   the region the stack was applied to
 *   MAIL_PROBE_TO                      an address verified in SES that you can read
 *   MAIL_FROM                          output ses_from_address
 *   SES_CONFIGURATION_SET              output ses_configuration_set
 *   SES_EVENT_QUEUE_URL                output mail_events_queue_url
 *
 *   export AWS_REGION=$(terraform -chdir=infra/stack output -raw region 2>/dev/null || echo ap-south-1)
 *   export MAIL_PROBE_TO=you@example.in
 *   export MAIL_FROM=$(terraform -chdir=infra/stack output -raw ses_from_address)
 *   export SES_CONFIGURATION_SET=$(terraform -chdir=infra/stack output -raw ses_configuration_set)
 *   export SES_EVENT_QUEUE_URL=$(terraform -chdir=infra/stack output -raw mail_events_queue_url)
 *   pnpm test:mail:live
 *
 * Until SES leaves the sandbox, MAIL_PROBE_TO has to be verified as well as the sender; the
 * restriction is on the recipient, not on sending.
 */

import { randomBytes } from 'node:crypto';
import { createSesProvider } from '../packages/mail/src/providers/ses.js';
import {
  pollSesEvents,
  readSesEvents,
  sqsTransport,
} from '../packages/mail/src/providers/ses-events.js';

/** What each variable is and where it comes from, so a missing one is a sentence, not a name. */
const REQUIRED = [
  ['MAIL_PROBE_TO', 'an address verified in SES that you can read the probe in'],
  ['MAIL_FROM', 'stack output ses_from_address'],
  ['SES_CONFIGURATION_SET', 'stack output ses_configuration_set'],
  ['SES_EVENT_QUEUE_URL', 'stack output mail_events_queue_url'],
];

const POLL_TIMEOUT_MS = 60_000;
const FAILURES = ['BOUNCE', 'COMPLAINT', 'REJECT', 'RENDERING_FAILURE'];

const out = (line = '') => process.stdout.write(`${line}\n`);

function env(name) {
  return process.env[name]?.trim() ?? '';
}

/**
 * Everything is checked before a single AWS client is constructed, so a machine with no stack gets
 * one clear refusal rather than a scatter of SDK errors.
 */
function readConfiguration() {
  const missing = REQUIRED.filter(([name]) => env(name) === '');
  const region = env('AWS_REGION') || env('AWS_DEFAULT_REGION');
  if (region === '') missing.push(['AWS_REGION or AWS_DEFAULT_REGION', 'the region the stack was applied to']);
  if (missing.length > 0) {
    out('The live mail suite cannot run: the stack is not configured in this shell.');
    out();
    out('It needs, from the stack outputs (terraform -chdir=infra/stack output):');
    for (const [name, why] of REQUIRED) out(`  ${name.padEnd(24)} ${why}`);
    out(`  ${'AWS_REGION'.padEnd(24)} the region the stack was applied to (AWS_DEFAULT_REGION also works)`);
    out();
    out(`Missing: ${missing.map(([name]) => name).join(', ')}.`);
    out('Apply the stack and export the outputs listed above, then run pnpm test:mail:live again.');
    return null;
  }

  const probeTo = env('MAIL_PROBE_TO').toLowerCase();
  if (!probeTo.includes('@')) {
    out(`MAIL_PROBE_TO does not look like an address: "${probeTo}".`);
    return null;
  }

  return {
    region: env('AWS_REGION') || env('AWS_DEFAULT_REGION'),
    probeTo,
    from: env('MAIL_FROM'),
    configurationSet: env('SES_CONFIGURATION_SET'),
    queueUrl: env('SES_EVENT_QUEUE_URL'),
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const config = readConfiguration();
  if (config === null) return 1;

  const token = `ML${randomBytes(6).toString('hex').toUpperCase()}`;
  const subject = `GrihaOne delivery probe ${token}`;
  out(`probe   ${token} → ${config.probeTo} (region ${config.region})`);

  const provider = createSesProvider({
    region: config.region,
    configurationSetName: config.configurationSet,
  });

  let providerMessageId;
  try {
    const result = await provider.send({
      to: config.probeTo,
      from: config.from,
      subject,
      text:
        `This is a delivery probe for the mail suite.\n\n` +
        `Token: ${token}\n\nIt was sent to prove this address receives what the application sends. ` +
        `No reply is needed.`,
      html:
        `<p style="margin:0 0 12px;">This is a delivery probe for the mail suite.</p>` +
        `<p style="margin:0 0 12px;">Token: <strong>${token}</strong></p>` +
        `<p style="margin:0;">It was sent to prove this address receives what the application ` +
        `sends. No reply is needed.</p>`,
      template: 'announcement.published',
      correlationId: token,
    });
    providerMessageId = result.providerMessageId;
    out(`sent    ${providerMessageId}`);
  } catch (cause) {
    out(`send    failed: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`);
    out('Check that MAIL_FROM is a verified identity in this region and that the credentials are valid.');
    return 1;
  }

  const transport = sqsTransport({ queueUrl: config.queueUrl, region: config.region });
  const carriedByProbe = (event) =>
    (event.subject ?? '').includes(token) || event.providerMessageId === providerMessageId;

  // Poll until both events are seen, or the budget runs out. A short tail read afterwards, because
  // a bounce can trail a delivery by seconds and an early exit would hide it.
  const seen = await pollSesEvents({
    transport,
    timeoutMs: POLL_TIMEOUT_MS,
    waitSeconds: 10,
    until: (events) =>
      events.some((event) => event.type === 'SEND' && carriedByProbe(event)) &&
      events.some((event) => event.type === 'DELIVERY' && carriedByProbe(event)),
  });
  await pause(2_000);
  const tail = await readSesEvents({ transport, maxMessages: 10, waitSeconds: 5 });
  const events = [...seen, ...tail];

  const failures = [];
  const send = events.filter((event) => event.type === 'SEND' && carriedByProbe(event));
  const delivery = events.filter((event) => event.type === 'DELIVERY' && carriedByProbe(event));
  const bad = events.filter((event) => FAILURES.includes(event.type) && carriedByProbe(event));

  if (send.length === 0) failures.push('no SEND event for the probe arrived within the budget');
  if (delivery.length === 0) failures.push('no DELIVERY event for the probe arrived within the budget');
  if (send.length > 0 && delivery.length > 0) {
    const sendAt = events.findIndex((event) => event.type === 'SEND' && carriedByProbe(event));
    const deliveryAt = events.findIndex((event) => event.type === 'DELIVERY' && carriedByProbe(event));
    if (deliveryAt < sendAt) failures.push('the DELIVERY event was recorded before the SEND event');
  }
  for (const event of bad) {
    failures.push(`SES reported ${event.type}${event.detail === null ? '' : ` (${event.detail})`}`);
  }

  for (const event of events) {
    out(`event   ${event.type.padEnd(10)} ${carriedByProbe(event) ? 'probe' : 'other'}  ${event.providerMessageId ?? ''}`);
  }

  if (failures.length === 0) {
    out('events  SEND then DELIVERY for the probe, nothing bounced, complained or was rejected');
  }

  // Drain whatever is left, so the next run starts clean — the same contract readSesEvents defaults to.
  let drained = 0;
  for (let pass = 0; pass < 10; pass += 1) {
    const rest = await readSesEvents({ transport, maxMessages: 10, waitSeconds: 1 });
    drained += rest.length;
    if (rest.length === 0) break;
  }
  out(`queue   drained (${drained} further event(s) removed)`);

  if (failures.length > 0) {
    out();
    for (const failure of failures) out(`failed  ${failure}`);
    return 1;
  }

  out('ok      the message left AWS and was delivered');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause) => {
    out(`unexpected: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`);
    process.exitCode = 1;
  });
