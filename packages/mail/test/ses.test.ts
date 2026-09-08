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
    to: 'priya@oneresi.local',
    from: 'OneResi <no-reply@oneresi.test>',
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
    const provider = createSesProvider({ region: 'ap-south-1', configurationSetName: 'oneresi-mail' });

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
      const provider = createSesProvider({ configurationSetName: 'oneresi-mail' });
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
      configurationSetName: 'oneresi-mail',
    });

    const result = await provider.send(aRequest());

    expect(result.providerMessageId).toBe('ses-test-1');
    expect(recording.sent).toHaveLength(1);
    const input = recording.sent[0];

    // The source identity, from configuration, not a guess.
    expect(input.FromEmailAddress).toBe('OneResi <no-reply@oneresi.test>');
    // Exactly one recipient. `toEqual` means there is no Cc or Bcc anywhere (D-29).
    expect(input.Destination).toEqual({ ToAddresses: ['priya@oneresi.local'] });
    // The configuration set whose event destination is the whole point of tier 3.
    expect(input.ConfigurationSetName).toBe('oneresi-mail');

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
      configurationSetName: 'oneresi-mail',
    });

    const result = await provider.send(aRequest());
    expect(result.providerMessageId).toBe('out-1');
  });
});

describe('what SES says back', () => {
  it('marks a rejection permanent, with the provider code on the error', async () => {
    const rejected = new Error('Email address is not verified. The following identities failed');
    rejected.name = 'MessageRejected';
    const provider = createSesProvider({
      client: recordingSesClient({ failWith: rejected }).client,
      configurationSetName: 'oneresi-mail',
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
      configurationSetName: 'oneresi-mail',
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
      configurationSetName: 'oneresi-mail',
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
    expect(sesConfigurationSet({ SES_CONFIGURATION_SET: 'oneresi-mail' })).toBe('oneresi-mail');
    expect(() => sesConfigurationSet({})).toThrow(/SES_CONFIGURATION_SET is not set/);
  });

  it('requires a sending identity whenever mail really leaves the machine', () => {
    expect(() => mailFrom({ EMAIL_DRIVER: 'ses' })).toThrow(/MAIL_FROM is not set/);
    expect(mailFrom({ MAIL_FROM: 'no-reply@oneresi.in' })).toBe('no-reply@oneresi.in');
    // Console mode keeps a reserved local address, which cannot reach a real mailbox.
    expect(mailFrom({})).toBe('OneResi <no-reply@oneresi.local>');
  });
});
