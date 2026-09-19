import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const WalkthroughRequestSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  societyName: z.string().trim().min(3, 'Society name must be at least 3 characters'),
  role: z.enum(['Committee Member', 'Resident', 'Facility Manager']),
  email: z.string().email('Must be a valid email address'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

function formatWalkthroughTicket(year: number, sequence: number): string {
  const padded = String(sequence).padStart(4, '0');
  return `WT-${year}-${padded}`;
}

function parseWalkthroughTicket(ticket: string): { year: number; sequence: number } | null {
  const match = ticket.match(/^WT-(\d{4})-(\d{4,})$/);
  if (!match || !match[1] || !match[2]) return null;
  return {
    year: Number(match[1]),
    sequence: Number(match[2]),
  };
}

describe('Walkthrough Request & Ticket Formatting', () => {
  it('validates a complete, authentic walkthrough request', () => {
    const input = {
      name: 'Aarav Sharma',
      societyName: 'Gulmohar Court CHS',
      role: 'Committee Member',
      email: 'aarav@gulmoharcourt.in',
      date: '2026-09-15',
    };
    const parsed = WalkthroughRequestSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it('trims extraneous whitespace from name and society name', () => {
    const input = {
      name: '   Priya Nair   ',
      societyName: '   Palm Villas Society   ',
      role: 'Resident',
      email: 'priya@palmvillas.in',
      date: '2026-09-20',
    };
    const parsed = WalkthroughRequestSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('Priya Nair');
      expect(parsed.data.societyName).toBe('Palm Villas Society');
    }
  });

  it('rejects an invalid email address', () => {
    const input = {
      name: 'Aarav Sharma',
      societyName: 'Gulmohar Court CHS',
      role: 'Committee Member',
      email: 'not-an-email',
      date: '2026-09-15',
    };
    const parsed = WalkthroughRequestSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Must be a valid email address');
    }
  });

  it('rejects too short society name', () => {
    const input = {
      name: 'Aarav Sharma',
      societyName: 'GC',
      role: 'Resident',
      email: 'resident@example.com',
      date: '2026-09-15',
    };
    const parsed = WalkthroughRequestSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('rejects unrecognized role option', () => {
    const input = {
      name: 'Aarav Sharma',
      societyName: 'Gulmohar Court',
      role: 'SuperAdmin',
      email: 'admin@example.com',
      date: '2026-09-15',
    };
    const parsed = WalkthroughRequestSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  it('formats walkthrough ticket number with padded 4-digit code', () => {
    expect(formatWalkthroughTicket(2026, 42)).toBe('WT-2026-0042');
    expect(formatWalkthroughTicket(2026, 9184)).toBe('WT-2026-9184');
  });

  it('enforces valid date regex format', () => {
    const invalidDate = {
      name: 'Aarav Sharma',
      societyName: 'Gulmohar Court CHS',
      role: 'Resident',
      email: 'resident@example.com',
      date: '15-09-2026',
    };
    const parsed = WalkthroughRequestSchema.safeParse(invalidDate);
    expect(parsed.success).toBe(false);
  });

  it('parses valid walkthrough ticket into year and sequence number', () => {
    expect(parseWalkthroughTicket('WT-2026-0042')).toEqual({ year: 2026, sequence: 42 });
    expect(parseWalkthroughTicket('WT-2027-1234')).toEqual({ year: 2027, sequence: 1234 });
  });

  it('returns null on corrupted or invalid ticket codes', () => {
    expect(parseWalkthroughTicket('INVALID')).toBeNull();
    expect(parseWalkthroughTicket('WT-26-42')).toBeNull();
    expect(parseWalkthroughTicket('REC-2026-0001')).toBeNull();
  });
});
