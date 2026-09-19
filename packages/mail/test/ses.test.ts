import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mailFrom, sesConfigurationSet, sesRegion } from '../src/env.js';
import { createSesProvider } from '../src/providers/ses.js';
import { recordingSesClient } from '../src/testing.js';
import type { SendRequest } from '../src/types.js';

/**
 * Tier 2 of the mail suite (docs/plan/05-testing.md): what the SES provider hands AWS, asserted
 * without spending anything.
 *
 * `recordingSesClient` stands where the real client goes and records the exact `SendEmailCommand`
 * input, so the region, the source identity, the configuration set name and the destination are
 * checked — the check that would have caught a "SES provider" which only wrote a console line and
 * had no AWS SDK to call (D-30).
 *
 * The first group additionally swaps `SESv2Client` for a recording class, because the region a
 * client is *constructed* with is the one thing an injected double can never see.
 */

interface FakeClient {
  readonly config: unknown;
  readonly sent: unknown[];
}

const constructed = vi.hoisted(() => [] as FakeClient[]);

vi.mock('@aws-sdk/client-sesv2', async (importOriginal) => {
  const actual = await importOriginal();
  class RecordingSesv2Client {
    readonly config: unknown;
    readonly sent: unknown[] = [];

    constructor(config: unknown) {
      this.config = config;
      constructed.push(this);
    }

    send(command: { readonly input: unknown }): Promise<{ readonly MessageId: string }> {
      this.sent.push(command.input);
      return Promise.resolve({ MessageId: `live-${this.sent.length}` });
    }
  }
  return { ...actual, SESv2Client: RecordingSesv2Client };
});

function aRequest(overrides: Partial<SendRequest> = {}): SendRequest {
  return {
    to: 'priya@grihaone.local',
    from: 'GrihaOne <no-reply@grihaone.test>',
    subject: 'Maintenance for September 2026',
    text: 'Your maintenance bill for September 2026 is ready.',
    html: '<p>Your maintenance bill for September 2026 is ready.</p>',
    template: 'invoice.raised',
    correlationId: 'corr-1',
    ...overrides,
  };
}

beforeEach(() => {
  constructed.length = 0;
});

describe('the client it builds', () => {
  it('constructs its client in the configured region, once, lazily', async () => {
    const provider = createSesProvider({ region: 'ap-south-1', configurationSetName: 'grihaone-mail' });

    expect(constructed).toHaveLength(0); // nothing happens until the first send
    const first = await provider.send(aRequest());
    const second = await provider.send(aRequest());

    expect(constructed).toHaveLength(1);
    expect(constructed[0].config).toEqual({ region: 'ap-south-1' });
    expect(constructed[0].sent).toHaveLength(2);
    expect(first.providerMessageId).toBe('live-1');
    expect(second.providerMessageId).toBe('live-2');
  });

  it('falls back to the environment region when none is given', async () => {
    vi.stubEnv('AWS_REGION', 'eu-west-1');
    try {
      const provider = createSesProvider({ configurationSetName: 'grihaone-mail' });
      await provider.send(aRequest());
      expect(constructed[0].config).toEqual({ region: 'eu-west-1' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('the command it sends', () => {
  it('carries the source identity, the one destination, the configuration set and both parts', async () => {
    const recording = recordingSesClient();
    const provider = createSesProvider({
      client: recording.client,
      configurationSetName: 'grihaone-mail',
    });

    const result = await provider.send(aRequest());

    expect(result.providerMessageId).toBe('ses-test-1');
    expect(recording.sent).toHaveLength(1);
    const input = recording.sent[0];

    // The source identity, from configuration, not a guess.
    expect(input.FromEmailAddress).toBe('GrihaOne <no-reply@grihaone.test>');
    // Exactly one recipient. `toEqual` means there is no Cc or Bcc anywhere (D-29).
    expect(input.Destination).toEqual({ ToAddresses: ['priya@grihaone.local'] });
    // The configuration set whose event destination is the whole point of tier 3.
    expect(input.ConfigurationSetName).toBe('grihaone-mail');

    expect(input.Content).toEqual({
      Simple: {
        Subject: { Data: 'Maintenance for September 2026', Charset: 'UTF-8' },
        Body: {
          Text: { Data: 'Your maintenance bill for September 2026 is ready.', Charset: 'UTF-8' },
          Html: {
            Data: '<p>Your maintenance bill for September 2026 is ready.</p>',
            Charset: 'UTF-8',
          },
        },
      },
    });

    // Message tags: the template name made tag-safe, and the correlation id.
    expect(input.EmailTags).toEqual([
      { Name: 'template', Value: 'invoice_raised' },
      { Name: 'correlation', Value: 'corr-1' },
    ]);
  });

  it('records the provider message id SES returned', async () => {
    const recording = recordingSesClient({ messageIdPrefix: 'out' });
    const provider = createSesProvider({
      client: recording.client,
      configurationSetName: 'grihaone-mail',
    });

    const result = await provider.send(aRequest());
    expect(result.providerMessageId).toBe('out-1');
  });
});

describe('what SES says back', () => {
  it('treats an unverified address as transient — it survives until the verification click', async () => {
    // A fresh stack's identities start PENDING until each mailbox owner clicks AWS's link; mail
    // written in that window must retry into FAILED (requeueable), not be abandoned as dead.
    const unverified = new Error('Email address is not verified. The following identities failed');
    unverified.name = 'MessageRejected';
    const provider = createSesProvider({
      client: recordingSesClient({ failWith: unverified }).client,
      configurationSetName: 'grihaone-mail',
    });

    await expect(provider.send(aRequest())).rejects.toMatchObject({
      name: 'MailDeliveryError',
      permanent: false,
      providerCode: 'MessageRejected',
    });
  });

  it('marks a sandbox recipient rejection permanent — no retry will verify a fictional address', async () => {
    // SES in sandbox mode answers an unverified RECIPIENT with AccessDeniedException naming that
    // recipient's identity. Every seeded fictional resident gets this answer; classified transient
    // it meant 36 addresses × 5 attempts of poison rows starved the rate budget real mail needed.
    const sandboxed = new Error(
      "User arn:aws:sts::1:assumed-role/notifier is not authorized to perform: ses:SendEmail on resource: arn:aws:ses:ap-south-1:1:identity/priya@grihaone.local",
    );
    sandboxed.name = 'AccessDeniedException';
    const provider = createSesProvider({
      client: recordingSesClient({ failWith: sandboxed }).client,
      configurationSetName: 'grihaone-mail',
    });

    await expect(provider.send(aRequest())).rejects.toMatchObject({
      name: 'MailDeliveryError',
      permanent: true,
      providerCode: 'AccessDeniedException',
    });
  });

  it('treats any other AccessDenied as a configuration problem — retryable, not dead', async () => {
    // An AccessDenied that does not name THIS message's recipient is the IAM policy missing the
    // sender or the configuration set: somebody's to fix, and the row must survive the fix.
    const policy = new Error(
      'User arn:aws:sts::1:assumed-role/notifier is not authorized to perform: ses:SendEmail on resource: arn:aws:ses:ap-south-1:1:configuration-set/grihaone-mail',
    );
    policy.name = 'AccessDeniedException';
    const provider = createSesProvider({
      client: recordingSesClient({ failWith: policy }).client,
      configurationSetName: 'grihaone-mail',
    });

    await expect(provider.send(aRequest())).rejects.toMatchObject({
      name: 'MailDeliveryError',
      permanent: false,
      providerCode: 'AccessDeniedException',
    });
  });

  it('marks a real rejection permanent, with the provider code on the error', async () => {
    const rejected = new Error('Recipient address suppressed by the account');
    rejected.name = 'MessageRejected';
    const provider = createSesProvider({
      client: recordingSesClient({ failWith: rejected }).client,
      configurationSetName: 'grihaone-mail',
    });

    await expect(provider.send(aRequest())).rejects.toMatchObject({
      name: 'MailDeliveryError',
      permanent: true,
      providerCode: 'MessageRejected',
    });
  });

  it('treatles throttling as transient, so the row keeps its attempts', async () => {
    const throttled = new Error('Too Many Requests');
    const provider = createSesProvider({
      client: recordingSesClient({ failWith: throttled }).client,
      configurationSetName: 'grihaone-mail',
    });

    await expect(provider.send(aRequest())).rejects.toMatchObject({
      name: 'MailDeliveryError',
      permanent: false,
      providerCode: 'Error',
    });
  });

  it('refuses a response that carries no message id', async () => {
    const provider = createSesProvider({
      client: { send: () => Promise.resolve({}) },
      configurationSetName: 'grihaone-mail',
    });

    await expect(provider.send(aRequest())).rejects.toMatchObject({
      name: 'MailDeliveryError',
      providerCode: 'NoMessageId',
      message: expect.stringContaining('no message id'),
    });
  });
});

describe('the environment it reads', () => {
  it('takes the region from AWS_REGION, then AWS_DEFAULT_REGION, and names the variable when neither is set', () => {
    expect(sesRegion({ AWS_REGION: 'ap-south-1', AWS_DEFAULT_REGION: 'eu-west-1' })).toBe('ap-south-1');
    expect(sesRegion({ AWS_DEFAULT_REGION: 'eu-west-1' })).toBe('eu-west-1');
    expect(() => sesRegion({})).toThrow(/AWS_REGION is not set/);
  });

  it('requires the configuration set, because its event destination is what tier 3 reads', () => {
    expect(sesConfigurationSet({ SES_CONFIGURATION_SET: 'grihaone-mail' })).toBe('grihaone-mail');
    expect(() => sesConfigurationSet({})).toThrow(/SES_CONFIGURATION_SET is not set/);
  });

  it('requires a sending identity whenever mail really leaves the machine', () => {
    expect(() => mailFrom({ EMAIL_DRIVER: 'ses' })).toThrow(/MAIL_FROM is not set/);
    expect(mailFrom({ MAIL_FROM: 'no-reply@grihaone.in' })).toBe('no-reply@grihaone.in');
    // Console mode keeps a reserved local address, which cannot reach a real mailbox.
    expect(mailFrom({})).toBe('GrihaOne <no-reply@grihaone.local>');
  });
});
