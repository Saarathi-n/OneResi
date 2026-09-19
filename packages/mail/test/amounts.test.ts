import { describe, expect, it } from 'vitest';
import { formatMoney, moneyInWords, paise, rupees, type Paise } from '@grihaone/contracts';
import { render } from '../src/render.js';
import * as templates from '../src/templates/index.js';
import type { RenderedMail } from '../src/types.js';

/**
 * The amounts assertion from docs/plan/05-testing.md: where a template shows money, the rendered
 * amount matches `formatMoney` from `@grihaone/contracts` to the paisa — the same figure the domain
 * snapshotted, formatted once at the presentation edge, never re-derived by the template (D-50).
 *
 * The five money-bearing templates are each rendered against amounts chosen to make a formatting
 * bug unavoidable: a round monthly bill, a paisa fraction, an Indian-grouping lakh figure, and a
 * fraction of a rupee. The receipt additionally spells the same amount out in words, and the two
 * lines have to agree with each other, not just with the oracle.
 */

const ORIGIN = 'https://app.example.test';
const AT = (iso: string): Date => new Date(iso);

const AMOUNTS: readonly Paise[] = [
  rupees(4800), // the round monthly bill
  paise(480_050), // a paisa fraction
  rupees(1_234_567), // Indian grouping, lakh and crore
  paise(5), // less than a rupee
];

function invoiceVars(amountPaise: Paise) {
  return {
    recipientName: 'Priya Menon',
    home: 'Block A · A-101',
    invoiceId: 204,
    period: '2026-09',
    amountPaise,
    dueOn: AT('2026-09-15T00:00:00.000Z'),
  };
}

function paymentVars(amountPaise: Paise) {
  return {
    recipientName: 'Priya Menon',
    home: 'Block A · A-101',
    period: '2026-09',
    receiptNo: 'REC-2026-09-00042',
    amountPaise,
    method: 'UPI',
    paidAt: AT('2026-09-12T13:10:00.000Z'),
    reference: 'PAY7KQ2XR9TLM',
  };
}

function bookingRequestedVars(amountPaise: Paise) {
  return {
    bookingId: 77,
    facilityName: 'Clubhouse',
    residentName: 'Priya Menon',
    home: 'Block A · A-101',
    bookingDate: AT('2026-09-20T00:00:00.000Z'),
    startTime: '18:00',
    endTime: '21:00',
    amountPaise,
  };
}

function bookingDecidedVars(amountPaise: Paise) {
  return {
    ...bookingRequestedVars(amountPaise),
    recipientName: 'Priya Menon',
    status: 'CONFIRMED',
    decidedByName: 'Suresh Iyer',
  };
}

const moneyTemplates = [
  { id: 'invoice.raised', make: invoiceVars, template: templates.invoiceRaised },
  {
    id: 'invoice.overdue',
    make: (amount: Paise) => ({ ...invoiceVars(amount), daysOverdue: 3 }),
    template: templates.invoiceOverdue,
  },
  { id: 'payment.received', make: paymentVars, template: templates.paymentReceived },
  {
    id: 'booking.requested',
    make: bookingRequestedVars,
    template: templates.bookingRequested,
  },
  { id: 'booking.decided', make: bookingDecidedVars, template: templates.bookingDecided },
] as const;

describe('the money oracle (D-50)', () => {
  it('pins what the oracle itself says, so a formatting regression is not mistaken for a template one', () => {
    expect(formatMoney(rupees(4800))).toBe('₹4,800.00');
    expect(formatMoney(paise(480_050))).toBe('₹4,800.50');
    expect(formatMoney(rupees(1_234_567))).toBe('₹12,34,567.00');
    expect(formatMoney(paise(5))).toBe('₹0.05');
    expect(moneyInWords(paise(480_050))).toBe(
      'Four thousand eight hundred rupees and fifty paise only',
    );
  });

  it.each(moneyTemplates)(
    '$id renders the amount exactly as the oracle formats it, in both parts',
    ({ template, make }) => {
      for (const amount of AMOUNTS) {
        const rendered: RenderedMail = render(template, make(amount), { origin: ORIGIN });
        const expected = formatMoney(amount);

        expect(rendered.variables['amount']).toBe(expected);
        expect(rendered.text).toContain(expected);
        expect(rendered.html).toContain(expected);
      }
    },
  );

  it('spells the receipt amount out, to the paisa, as the same amount in words', () => {
    for (const amount of AMOUNTS) {
      const rendered = render(templates.paymentReceived, paymentVars(amount), {
        origin: ORIGIN,
      });
      const words = moneyInWords(amount);

      expect(rendered.variables['amountInWords']).toBe(words);
      expect(rendered.text).toContain(words);
      expect(rendered.html).toContain(words);
    }
  });
});
