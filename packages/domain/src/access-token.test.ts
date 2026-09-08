import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import * as C from '@oneresi/contracts';
import { joseAccessToken } from './access-token.js';
import type { AccessTokenClaims } from './access-token.js';

/**
 * The token is a credential: these tests hold that it verifies what it signed, refuses
 * everything else, and expires against the injected clock — not the wall clock, which is why
 * the clock here is a hand that moves.
 */

const SECRET = new TextEncoder().encode('access-token-test-secret-0123456789');

class MutableClock {
  #now: Date;
  constructor(iso: string) {
    this.#now = new Date(iso);
  }
  now(): Date {
    return this.#now;
  }
  advanceMs(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

const CLAIMS: AccessTokenClaims = {
  sub: 42,
  role: 'R',
  unitId: 7,
  email: 'asha@example.com',
  pwd: 1_754_000_000,
};

describe('joseAccessToken', () => {
  it('round-trips its claims', async () => {
    const clock = new MutableClock('2026-09-08T09:00:00Z');
    const tokens = joseAccessToken(SECRET, clock);
    const token = await tokens.sign(CLAIMS, clock.now());
    const verified = await tokens.verify(token);
    expect(verified).toEqual(CLAIMS);
  });

  it('carries the pwd stamp — the claim D-23 depends on', async () => {
    const clock = new MutableClock('2026-09-08T09:00:00Z');
    const tokens = joseAccessToken(SECRET, clock);
    const token = await tokens.sign(CLAIMS, clock.now());
    const verified = await tokens.verify(token);
    expect(verified?.pwd).toBe(CLAIMS.pwd);
  });

  it('expires after ACCESS_TOKEN_TTL_SECONDS on the injected clock', async () => {
    const clock = new MutableClock('2026-09-08T09:00:00Z');
    const tokens = joseAccessToken(SECRET, clock);
    const token = await tokens.sign(CLAIMS, clock.now());

    clock.advanceMs((C.ACCESS_TOKEN_TTL_SECONDS - 1) * 1000);
    expect(await tokens.verify(token)).not.toBeNull();

    clock.advanceMs(2 * 1000);
    expect(await tokens.verify(token)).toBeNull();
  });

  it('refuses garbage and a token signed with a different secret', async () => {
    const clock = new MutableClock('2026-09-08T09:00:00Z');
    const tokens = joseAccessToken(SECRET, clock);
    const other = joseAccessToken(
      new TextEncoder().encode('a-completely-different-secret-value'),
      clock,
    );

    expect(await tokens.verify('not-a-token')).toBeNull();
    expect(await tokens.verify('')).toBeNull();

    const forged = await other.sign(CLAIMS, clock.now());
    expect(await tokens.verify(forged)).toBeNull();
  });

  it('refuses a token whose role is not one of the roles', async () => {
    const clock = new MutableClock('2026-09-08T09:00:00Z');
    const tokens = joseAccessToken(SECRET, clock);

    // Signed with the right key, so the signature is valid — but the payload lies.
    const token = await new SignJWT({ role: 'SUPERUSER', pwd: 1, email: 'x@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('42')
      .setIssuedAt(Math.floor(clock.now().getTime() / 1000))
      .setExpirationTime(Math.floor(clock.now().getTime() / 1000) + 900)
      .sign(SECRET);

    expect(await tokens.verify(token)).toBeNull();
  });
});
