import { describe, expect, it } from 'vitest';
import { rupees } from '@oneresi/contracts';
import { appOrigin } from '../src/env.js';
import { PayloadError, RenderError } from '../src/errors.js';
import { absoluteUrl } from '../src/links.js';
import { decodeMailJob } from '../src/payload.js';
import { assertNoCourseworkFraming, render, renderById } from '../src/render.js';
import * as templates from '../src/templates/index.js';
import { TEMPLATE_IDS, type RenderedMail, type TemplateId } from '../src/types.js';
import { backoffMs, MAX_ATTEMPTS } from '../src/worker.js';

/**
 * The properties the mail suite in docs/plan/05-testing.md asserts, checked against every template at
 * once: both parts present, no use-case identifier anywhere, every link absolute and on the configured
 * origin, HTML that needs no stylesheet, and amounts formatted rather than calculated.
 *
 * Pure — no database, no provider. The tiers that need those live in the integration suite.
 */

const ORIGIN = 'https://app.example.test';
const RESET_TOKEN = 'Ff7Kq2xR-9tLmA3bZs0YwQ8vN1cJdH6e';
const AT = (iso: string): Date => new Date(iso);

const cases: readonly { readonly id: TemplateId; readonly rendered: RenderedMail }[] = [
  {
    id: 'resident.registered',
    rendered: render(
      templates.residentRegistered,
      {
        applicantId: 41,
        applicantName: 'Ravi Kumar',
        applicantEmail: 'ravi@oneresi.local',
        applicantPhone: '+919876512345',
        home: 'Block A · A-101',
        claimNote: 'Ours is the corner flat facing the park; it was not on the list.',
        submittedAt: AT('2026-09-01T09:20:00.000Z'),
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'resident.approved',
    rendered: render(
      templates.registrationApproved,
      { recipientName: 'Ravi Kumar', home: 'Block A · A-101' },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'resident.declined',
    rendered: render(
      templates.registrationDeclined,
      {
        recipientName: 'Ravi Kumar',
        home: 'Block A · A-101',
        reason: 'The flat is already registered to another household.',
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'password.reset_requested',
    rendered: render(
      templates.passwordReset,
      {
        recipientName: 'Priya Menon',
        token: RESET_TOKEN,
        expiresAt: AT('2026-09-05T12:45:00.000Z'),
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'walkin.awaiting_decision',
    rendered: render(
      templates.visitorWaiting,
      {
        recipientName: 'Priya Menon',
        visitorName: 'Anita Rao',
        purpose: 'Parcel delivery',
        visitorPhone: '+919812345678',
        arrivedAt: AT('2026-09-05T12:40:00.000Z'),
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'walkin.decided',
    rendered: render(
      templates.visitorDecided,
      {
        visitorName: 'Anita Rao',
        purpose: 'Parcel delivery',
        decision: 'APPROVED',
        decidedByName: 'Priya Menon',
        decidedAt: AT('2026-09-05T12:42:00.000Z'),
        home: 'Block A · A-101',
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'complaint.updated',
    rendered: render(
      templates.complaintStatusChanged,
      {
        recipientName: 'Priya Menon',
        complaintId: 18,
        category: 'PLUMBING',
        status: 'RESOLVED',
        note: 'Replaced the inlet valve and checked the pressure on both taps.',
        updatedByName: 'Suresh Iyer',
        updatedAt: AT('2026-09-04T06:15:00.000Z'),
        reopenableUntil: AT('2026-09-11T00:00:00.000Z'),
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'invoice.raised',
    rendered: render(
      templates.invoiceRaised,
      {
        recipientName: 'Priya Menon',
        home: 'Block A · A-101',
        invoiceId: 204,
        period: '2026-09',
        amountPaise: rupees(4800),
        dueOn: AT('2026-09-15T00:00:00.000Z'),
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'invoice.overdue',
    rendered: render(
      templates.invoiceOverdue,
      {
        recipientName: 'Priya Menon',
        home: 'Block A · A-101',
        invoiceId: 204,
        period: '2026-09',
        amountPaise: rupees(4800),
        dueOn: AT('2026-09-15T00:00:00.000Z'),
        daysOverdue: 3,
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'payment.received',
    rendered: render(
      templates.paymentReceived,
      {
        recipientName: 'Priya Menon',
        home: 'Block A · A-101',
        period: '2026-09',
        receiptNo: 'REC-2026-09-00042',
        amountPaise: rupees(4800),
        method: 'UPI',
        paidAt: AT('2026-09-12T13:10:00.000Z'),
        reference: 'PAY7KQ2XR9TLM',
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'booking.requested',
    rendered: render(
      templates.bookingRequested,
      {
        bookingId: 77,
        facilityName: 'Clubhouse',
        residentName: 'Priya Menon',
        home: 'Block A · A-101',
        bookingDate: AT('2026-09-20T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '21:00',
        amountPaise: rupees(450),
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'booking.decided',
    rendered: render(
      templates.bookingDecided,
      {
        recipientName: 'Priya Menon',
        bookingId: 77,
        facilityName: 'Clubhouse',
        bookingDate: AT('2026-09-20T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '21:00',
        status: 'CONFIRMED',
        amountPaise: rupees(450),
        decidedByName: 'Suresh Iyer',
      },
      { origin: ORIGIN },
    ),
  },
  {
    id: 'announcement.published',
    rendered: render(
      templates.announcementPublished,
      {
        announcementId: 12,
        title: 'Water supply off on Friday morning',
        body:
          'The overhead tanks are being cleaned on Friday.\n\nSupply will be off from 9 am until ' +
          'about 1 pm. Please store what you need the night before.',
        category: 'MAINTENANCE',
        authorName: 'Suresh Iyer',
        publishedAt: AT('2026-09-02T11:00:00.000Z'),
        expiresOn: AT('2026-09-06T00:00:00.000Z'),
      },
      { origin: ORIGIN },
    ),
  },
];

const byId = (id: TemplateId): RenderedMail => {
  const found = cases.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No fixture for ${id}`);
  return found.rendered;
};

const urlsIn = (text: string): readonly string[] => [
  ...text.matchAll(/\b(?:https?|ftp|file):\/\/[^\s"'<>)\]]+/gi),
].map((match) => match[0]);

describe('the template set', () => {
  it('covers every declared template exactly once', () => {
    expect(cases.map((entry) => entry.id).sort()).toEqual([...TEMPLATE_IDS].sort());
  });
});

describe.each(cases)('$id', ({ rendered }) => {
  it('has a subject, a text part and an HTML part', () => {
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.subject.length).toBeLessThanOrEqual(240);
    expect(rendered.text.trim().length).toBeGreaterThan(40);
    expect(rendered.html.trim().length).toBeGreaterThan(80);
  });

  it('reads as product copy, with no use-case identifier anywhere', () => {
    expect(() =>
      assertNoCourseworkFraming(rendered.subject, rendered.text, rendered.html),
    ).not.toThrow();
  });

  it('renders without a stylesheet and without a table', () => {
    expect(rendered.html).not.toMatch(/<style[\s>]/i);
    expect(rendered.html).not.toMatch(/<link[\s>]/i);
    expect(rendered.html).not.toMatch(/\sclass="/i);
    expect(rendered.html).not.toMatch(/<table[\s>]/i);
    expect(rendered.html).toContain('style="');
  });

  it('links only to the configured origin, absolutely (D-22)', () => {
    const urls = [...urlsIn(rendered.text), ...urlsIn(rendered.html)];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(rendered.text).not.toContain('localhost');
    expect(rendered.html).not.toMatch(/href="\/(?!\/)/);
  });

  it('records display-ready variables and stays small enough not to be clipped', () => {
    expect(Object.keys(rendered.variables).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(rendered.variables)) {
      expect(key).not.toBe('');
      expect(typeof value).toBe('string');
    }
    expect(rendered.html.length).toBeLessThan(60_000);
  });
});

describe('the September invoice, from the JSON a handler writes', () => {
  const payload = JSON.stringify({
    to: { email: 'Priya@OneResi.local', name: 'Priya Menon' },
    template: 'invoice.raised',
    vars: {
      recipientName: 'Priya Menon',
      home: 'Block A · A-101',
      invoiceId: 204,
      period: '2026-09',
      amountPaise: 480_000,
      dueOn: '2026-09-15',
    },
  });

  it('addresses one person, lower cased', () => {
    const job = decodeMailJob('invoice.raised', payload);
    expect(job.to.email).toBe('priya@oneresi.local');
    expect(job.template).toBe('invoice.raised');
  });

  it('renders the subject and amounts the mail suite asserts', () => {
    const job = decodeMailJob('invoice.raised', payload);
    const rendered = renderById(job.template, job.vars, { origin: ORIGIN });

    expect(rendered.subject).toBe('Maintenance for September 2026');
    expect(rendered.variables['amount']).toBe('₹4,800.00');
    expect(rendered.variables['dueDate']).toBe('15 Sep 2026');
    expect(rendered.variables['period']).toBe('September 2026');
    expect(rendered.text).toContain(`${ORIGIN}/a/dues/204`);
    expect(rendered.text).toContain('₹4,800.00');
  });
});

describe('particular messages', () => {
  it('puts the reset token in the link and keeps it out of the recorded variables', () => {
    const rendered = byId('password.reset_requested');
    expect(rendered.text).toContain(`${ORIGIN}/reset-password?token=${RESET_TOKEN}`);
    expect(Object.values(rendered.variables).join(' ')).not.toContain(RESET_TOKEN);
  });

  it('gives the receipt its number and the amount in words', () => {
    const rendered = byId('payment.received');
    expect(rendered.subject).toBe('Receipt REC-2026-09-00042 — maintenance for September 2026');
    expect(rendered.variables['amountInWords']).toBe('Four thousand eight hundred rupees only');
    expect(rendered.variables['method']).toBe('UPI');
    expect(rendered.text).toContain(`${ORIGIN}/a/receipts/REC-2026-09-00042`);
  });

  it('renders enumerations through their label maps (D-55)', () => {
    expect(byId('complaint.updated').subject).toBe('Plumbing complaint — Fixed');
    expect(byId('walkin.decided').subject).toBe('Gate decision for Anita Rao: Let in');
    expect(byId('announcement.published').subject).toBe(
      'Maintenance: Water supply off on Friday morning',
    );
    expect(byId('booking.decided').subject).toBe('Clubhouse on 20 Sep 2026 — Confirmed');
  });
});

describe('the envelope', () => {
  const one = (to: unknown): string => JSON.stringify({ to, vars: {} });

  it('refuses a list of recipients: one message goes to one person (D-29)', () => {
    expect(() => decodeMailJob('invoice.raised', one([{ email: 'a@example.test' }]))).toThrow(
      PayloadError,
    );
  });

  it('refuses an event that has no email template', () => {
    expect(() => decodeMailJob('pass.created', one({ email: 'a@example.test' }))).toThrow(
      PayloadError,
    );
  });

  it('refuses a payload that is not JSON, and one with no recipient', () => {
    expect(() => decodeMailJob('invoice.raised', 'not json at all')).toThrow(PayloadError);
    expect(() => decodeMailJob('invoice.raised', one({ email: 'nobody' }))).toThrow(PayloadError);
  });

  it('names the field when a variable is wrong', () => {
    expect(() =>
      renderById(
        'invoice.raised',
        {
          recipientName: 'Priya Menon',
          home: 'Block A · A-101',
          invoiceId: 204,
          period: '2026-9',
          amountPaise: 480_000,
          dueOn: '2026-09-15',
        },
        { origin: ORIGIN },
      ),
    ).toThrow(/period/);
  });
});

describe('links', () => {
  const invoiceVars = {
    recipientName: 'Priya Menon',
    home: 'Block A · A-101',
    invoiceId: 204,
    period: '2026-09',
    amountPaise: rupees(4800),
    dueOn: AT('2026-09-15T00:00:00.000Z'),
  };

  it('has no origin fallback at all (D-22)', () => {
    expect(() => appOrigin({})).toThrow(/APP_ORIGIN/);
    expect(appOrigin({ APP_ORIGIN: 'https://app.oneresi.in/' })).toBe('https://app.oneresi.in');
    expect(() => appOrigin({ APP_ORIGIN: 'https://app.oneresi.in/admin' })).toThrow();
  });

  it('refuses a path that is not rooted', () => {
    expect(() => absoluteUrl('a/dues', ORIGIN)).toThrow();
    expect(absoluteUrl('/a/dues', ORIGIN)).toBe(`${ORIGIN}/a/dues`);
  });

  it('refuses to render a message that points at another host', () => {
    expect(() =>
      render(
        {
          ...templates.invoiceRaised,
          text: () => 'Pay your dues at http://localhost:3000/a/dues',
          html: () => '<p style="margin:0;">Pay your dues</p>',
        },
        invoiceVars,
        { origin: ORIGIN },
      ),
    ).toThrow(RenderError);
  });

  it('refuses a relative link in the HTML part', () => {
    expect(() =>
      render(
        {
          ...templates.invoiceRaised,
          text: () => `Pay your dues: ${ORIGIN}/a/dues`,
          html: () => '<a href="/a/dues">Pay</a>',
        },
        invoiceVars,
        { origin: ORIGIN },
      ),
    ).toThrow(RenderError);
  });
});

describe('the retry policy', () => {
  it('doubles the wait and then stops growing', () => {
    expect(backoffMs(1)).toBe(15_000);
    expect(backoffMs(2)).toBe(30_000);
    expect(backoffMs(3)).toBe(60_000);
    expect(backoffMs(MAX_ATTEMPTS)).toBeLessThanOrEqual(15 * 60_000);
    expect(backoffMs(40)).toBe(15 * 60_000);
  });
});




