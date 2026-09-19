import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../client.js';
import { rateLimiter } from './rate-limit.js';

/**
 * The Prisma truth for RateLimiter: the fixed-window counter. The hard part is the boundary — two
 * concurrent sign-in attempts must not both pass a limit of one — so the tests hammer consume()
 * in parallel, prove a window older than its limit no longer counts, and prove clear() forgives.
 */

interface Harness {
  readonly testDatabase: () => Promise<{ db: Db; provider: 'sqlite' | 'postgresql' }>;
}

const HARNESS = '../../../../test/helpers/database.js';

const { testDatabase } = (await import(HARNESS)) as Harness;

let db: Db;

beforeAll(async () => {
  db = (await testDatabase()).db;
});

describe('rateLimiter', () => {
  it('allows up to the limit, then denies with a retry time inside the window', async () => {
    const limiter = rateLimiter(db);
    const key = `enforce-${Date.now()}`;

    for (let i = 0; i < 3; i += 1) {
      const verdict = await limiter.consume(key, { attempts: 3, windowSeconds: 3600 });
      expect(verdict).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }

    const denied = await limiter.consume(key, { attempts: 3, windowSeconds: 3600 });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('counts each key separately', async () => {
    const limiter = rateLimiter(db);
    const stamp = Date.now();

    expect(await limiter.consume(`key-a-${stamp}`, { attempts: 1, windowSeconds: 3600 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect((await limiter.consume(`key-a-${stamp}`, { attempts: 1, windowSeconds: 3600 })).allowed)
      .toBe(false);
    // A different key — a different visitor — is not affected by that one.
    expect((await limiter.consume(`key-b-${stamp}`, { attempts: 1, windowSeconds: 3600 })).allowed)
      .toBe(true);
  });

  it('a window older than its limit no longer counts', async () => {
    const limiter = rateLimiter(db);
    const key = `stale-${Date.now()}`;
    // A visitor who burned through five attempts two minutes ago: that window is over.
    await db.rateLimitWindow.create({
      data: { key, windowStartedAt: new Date(Date.now() - 120_000), attempts: 5 },
    });

    const verdict = await limiter.consume(key, { attempts: 3, windowSeconds: 60 });
    expect(verdict).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('reports the time left in the CURRENT window, not the stale one', async () => {
    const limiter = rateLimiter(db);
    const key = `left-${Date.now()}`;
    // Pre-fill this minute's window to the limit, so the next consume is a denial with a
    // countdown that must point at the end of this minute.
    const minuteStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await db.rateLimitWindow.create({
      data: { key, windowStartedAt: minuteStart, attempts: 3 },
    });

    const denied = await limiter.consume(key, { attempts: 3, windowSeconds: 60 });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('a new window opens once the old one expires', async () => {
    const limiter = rateLimiter(db);
    const key = `expire-${Date.now()}`;

    // Start well inside the second so first and second comfortably share the same window
    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 600) {
      await new Promise((resolve) => setTimeout(resolve, 1050 - msIntoSecond));
    }

    const first = await limiter.consume(key, { attempts: 1, windowSeconds: 1 });
    expect(first.allowed).toBe(true);
    const second = await limiter.consume(key, { attempts: 1, windowSeconds: 1 });
    expect(second.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const third = await limiter.consume(key, { attempts: 1, windowSeconds: 1 });
    expect(third.allowed).toBe(true);
  });

  it('clears every window row for the key — a successful sign-in forgives the typos', async () => {
    const limiter = rateLimiter(db);
    const key = `clear-${Date.now()}`;
    await limiter.consume(key, { attempts: 2, windowSeconds: 3600 });
    await limiter.consume(key, { attempts: 2, windowSeconds: 3600 });
    expect((await limiter.consume(key, { attempts: 2, windowSeconds: 3600 })).allowed).toBe(false);

    await limiter.clear(key);

    expect(await db.rateLimitWindow.count({ where: { key } })).toBe(0);
    expect((await limiter.consume(key, { attempts: 2, windowSeconds: 3600 })).allowed).toBe(true);
  });

  it('lets exactly the limit through under eight concurrent attempts', async () => {
    const limiter = rateLimiter(db);
    const key = `race-${Date.now()}`;

    const verdicts = await Promise.all(
      Array.from({ length: 8 }, () => limiter.consume(key, { attempts: 3, windowSeconds: 3600 })),
    );

    const allowed = verdicts.filter((verdict) => verdict.allowed).length;
    expect(allowed).toBe(3);
    // And the row itself tells the same story the verdicts do.
    expect(await db.rateLimitWindow.count({ where: { key } })).toBe(1);
    const row = await db.rateLimitWindow.findFirstOrThrow({ where: { key } });
    expect(row.attempts).toBe(8);
  });
});
