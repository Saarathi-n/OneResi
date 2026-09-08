import type { AccountStore, RateLimiter } from './store.js';
import type { PasswordHasher } from './passwords.js';
import type { AccessTokenSigner } from './access-token.js';
import type { Clock } from './clock.js';
import { hash, compare } from 'bcryptjs';

/**
 * The environment every service shares: time, and the secret. No fallbacks exist for either —
 * a wiring that cannot supply them fails at boot, in one place, with a message a person can
 * read (D-05's lesson: a missing secret must not silently become a constant).
 */
export interface ServiceEnv {
  readonly clock: Clock;
  /** 32 bytes or more. Validated by the adapter that uses it, never defaulted. */
  readonly jwtSecret: Uint8Array;
}

/**
 * The accounts service and everything it needs. A route handler receives one of these,
 * wired at boot — the factory is the composition root, and nothing after it reaches
 * around the seam.
 */
export interface AccountsDeps {
  readonly store: AccountStore;
  readonly limiter: RateLimiter;
  readonly hasher: PasswordHasher;
  readonly tokens: AccessTokenSigner;
  readonly env: ServiceEnv;
}

/**
 * The bcryptjs adapter. Cost arrives from contracts, in exactly one place, and is never a
 * literal here and never 10 (D-43). Both operations are async — `hashSync` at module load is
 * what blocked the event loop on every cold start of the previous build (D-43).
 */
export function bcryptHasher(cost: number): PasswordHasher {
  return {
    hash: (plain) => hash(plain, cost),
    compare: (plain, stored) => compare(plain, stored),
  };
}
