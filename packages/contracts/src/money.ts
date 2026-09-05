/**
 * Money is an integer count of paise. Everywhere.
 *
 * Not `Decimal`, not a float, not a string that gets `parseFloat`-ed. The previous build was
 * all three at different points in one flow (D-50), and `Decimal` is also the one Prisma type
 * that behaves differently on SQLite and PostgreSQL — so integers are what let one schema
 * serve both targets.
 *
 * Rules:
 *   - the database stores `*_paise Int`
 *   - the domain layer only ever adds and subtracts integers
 *   - a fraction exists in exactly one place: `formatMoney`, at the presentation edge
 */

/** Branded so a paise count cannot be confused with a rupee amount or any other integer. */
export type Paise = number & { readonly __brand: 'Paise' };

const MAX_PAISE = 1_000_000_000_00; // ₹100 crore. A society charge above this is a typo.

export function paise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Money must be a whole number of paise, received ${value}`);
  }
  if (value < 0 || value > MAX_PAISE) {
    throw new RangeError(`Money out of range: ${value} paise`);
  }
  return value as Paise;
}

/** For seeds, fixtures and admin input expressed in rupees. Rejects sub-paise precision. */
export function rupees(value: number): Paise {
  const asPaise = Math.round(value * 100);
  if (Math.abs(value * 100 - asPaise) > 1e-9) {
    throw new RangeError(`₹${value} is finer than one paisa`);
  }
  return paise(asPaise);
}

export const ZERO = paise(0);

export function addMoney(...values: readonly Paise[]): Paise {
  return paise(values.reduce<number>((total, v) => total + v, 0));
}

export function subtractMoney(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

/** Multiply by a count (hours booked, months billed). Never by a fraction. */
export function timesMoney(value: Paise, count: number): Paise {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Count must be a non-negative integer, received ${count}`);
  }
  return paise(value * count);
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_WHOLE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * The only place a fraction appears. `compact` drops `.00` for round amounts, which is what
 * you want in a list and not what you want on a receipt.
 */
export function formatMoney(value: Paise, options?: { compact?: boolean }): string {
  const asRupees = value / 100;
  return options?.compact === true && value % 100 === 0
    ? INR_WHOLE.format(asRupees)
    : INR.format(asRupees);
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

function underThousand(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n] ?? '';
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)] ?? '';
    const ones = ONES[n % 10] ?? '';
    return ones === '' ? tens : `${tens}-${ones}`;
  }
  const rest = underThousand(n % 100);
  const hundreds = `${ONES[Math.floor(n / 100)] ?? ''} hundred`;
  return rest === '' ? hundreds : `${hundreds} and ${rest}`;
}

/**
 * Indian grouping — crore, lakh, thousand — for the amount-in-words line a receipt needs.
 * See docs/plan/04-product-design.md.
 */
export function moneyInWords(value: Paise): string {
  const whole = Math.floor(value / 100);
  const fraction = value % 100;

  const groups: string[] = [];
  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1_000);
  const remainder = whole % 1_000;

  if (crore > 0) groups.push(`${underThousand(crore)} crore`);
  if (lakh > 0) groups.push(`${underThousand(lakh)} lakh`);
  if (thousand > 0) groups.push(`${underThousand(thousand)} thousand`);
  if (remainder > 0) groups.push(underThousand(remainder));

  const rupeePart = groups.length === 0 ? 'zero' : groups.join(' ');
  const paisePart = fraction > 0 ? ` and ${underThousand(fraction)} paise` : '';
  const sentence = `${rupeePart} rupees${paisePart} only`;

  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
