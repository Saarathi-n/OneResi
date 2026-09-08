import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { ACCESS_TOKEN_TTL_SECONDS, ROLES, type Role } from '@oneresi/contracts';
import type { Clock } from './clock.js';

/**
 * A 15-minute access token, signed HS256 with the process's secret. The previous build's
 * seven-day token is what let a DISABLED account keep full access for a week (D-24); the short
 * token bounds that window, and the `pwd` claim closes it entirely.
 */

/**
 * What goes in the token. `pwd` is the account's `passwordChangedAt` at issue time (null never
 * happens in practice — every account is created with a stamp — but the type allows a legacy
 * row). Verification compares it to the live value and refuses a match, so a password change is
 * a session kill for every token issued before it (D-23).
 *
 * `jti` is a random id. Nothing looks it up — rotation and family revocation live on the
 * refresh side, where they belong — but every token has one so logs can correlate a request
 * without printing a signed credential.
 */
export interface AccessTokenClaims {
  readonly sub: number;
  readonly role: Role;
  readonly unitId: number | null;
  readonly email: string;
  /** passwordChangedAt in seconds since epoch, at issue time. */
  readonly pwd: number | null;
}

/** Signing is async in jose, as in bcrypt; the adapters keep that. No hash is ever sync (D-43). */
export interface AccessTokenSigner {
  sign(claims: AccessTokenClaims, issuedAt: Date): Promise<string>;
  /** Verifies signature and expiry against the given clock. Claims are NOT policy-checked. */
  verify(token: string): Promise<AccessTokenClaims | null>;
}

/** The jose adapter. The secret arrives from the environment; there is no fallback here (D-05). */
export function joseAccessToken(secret: Uint8Array, clock: Clock): AccessTokenSigner {
  return {
    async sign(claims, issuedAt) {
      const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
      return new SignJWT({
        role: claims.role,
        ...(claims.unitId === null ? {} : { unitId: claims.unitId }),
        email: claims.email,
        ...(claims.pwd === null ? {} : { pwd: claims.pwd }),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(claims.sub))
        .setJti(randomUUID())
        .setIssuedAt(issuedAtSeconds)
        .setExpirationTime(issuedAtSeconds + ACCESS_TOKEN_TTL_SECONDS)
        .sign(secret);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, secret, {
          // Verified against the injected clock, not the wall clock, so tests age a token by
          // moving one hand.
          currentDate: clock.now(),
        });

        const sub = Number(payload.sub);
        const role = ROLES.find((candidate) => candidate === payload.role);
        if (!Number.isInteger(sub) || sub <= 0 || role === undefined) return null;

        const claims: AccessTokenClaims = {
          sub,
          role,
          unitId: typeof payload.unitId === 'number' ? payload.unitId : null,
          email: typeof payload.email === 'string' ? payload.email : '',
          pwd: typeof payload.pwd === 'number' ? payload.pwd : null,
        };
        return claims;
      } catch {
        // Bad signature, bad shape, expired — a bad token is a bad token. No logging of token
        // contents; a token is a credential.
        return null;
      }
    },
  };
}
