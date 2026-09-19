import { describe, expect, it } from 'vitest';
import { DOMAIN_TABLES, INFRASTRUCTURE_TABLES, NATURAL_KEYS } from './tables.js';

describe('Table Manifest Integrity (Bug 28)', () => {
  it('includes bookingSlotHold in INFRASTRUCTURE_TABLES', () => {
    expect(INFRASTRUCTURE_TABLES).toContain('bookingSlotHold');
  });

  it('includes pushSubscription in INFRASTRUCTURE_TABLES', () => {
    expect(INFRASTRUCTURE_TABLES).toContain('pushSubscription');
  });

  it('provides natural keys for every domain table', () => {
    for (const table of DOMAIN_TABLES) {
      expect(NATURAL_KEYS[table]).toBeDefined();
      expect(NATURAL_KEYS[table].length).toBeGreaterThan(0);
    }
  });

  it('has no overlap between DOMAIN_TABLES and INFRASTRUCTURE_TABLES', () => {
    const domainSet = new Set<string>(DOMAIN_TABLES);
    for (const infraTable of INFRASTRUCTURE_TABLES) {
      expect(domainSet.has(infraTable)).toBe(false);
    }
  });
});
