import { describe, expect, it } from 'vitest';
import * as C from '@grihaone/contracts';
import { getRounds } from 'bcryptjs';
import { bcryptHasher } from './deps.js';

/**
 * The bcrypt adapter, held to the two things ADR 0001 and D-43 fixed: the cost is whatever
 * contracts say (12, never a literal 10), and both operations stay async.
 */

describe('bcryptHasher', () => {
  it('hashes at the cost contracts mandate, and compares true only for the original', async () => {
    const hasher = bcryptHasher(C.BCRYPT_COST);
    const hash = await hasher.hash('Reasonable1!');

    expect(hash.startsWith(`$2b$${C.BCRYPT_COST}$`)).toBe(true);
    expect(getRounds(hash)).toBe(C.BCRYPT_COST);

    expect(await hasher.compare('Reasonable1!', hash)).toBe(true);
    expect(await hasher.compare('Reasonable2!', hash)).toBe(false);
  });

  it('salts: the same password never hashes to the same value twice', async () => {
    const hasher = bcryptHasher(C.BCRYPT_COST);
    const first = await hasher.hash('Reasonable1!');
    const second = await hasher.hash('Reasonable1!');
    expect(first).not.toBe(second);
  });
});
