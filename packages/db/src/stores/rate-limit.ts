import type { RateLimiter, RateLimitVerdict } from '@grihaone/domain';
import type { Db } from '../client.js';

/**
 * The RateLimiter port over the rate_limit_window table: a fixed-window counter per key, one
 * row per (key, window).
 *
 * The window boundaries are epoch-aligned — `floor(now / windowSeconds)` — and that is a
 * correctness decision, not a convenience. If a window started at the first attempt instead,
 * two concurrent first attempts would open two different windows, both see "attempts: 1", and
 * both pass a limit of one. Aligned windows give every attempt inside one window the SAME
 * natural key, so the unique index forces them onto one row and the database serialises them.
 */
export function rateLimiter(db: Db): RateLimiter {
  const limiter: RateLimiter = {
    async consume(key, limit): Promise<RateLimitVerdict> {
      const windowMs = limit.windowSeconds * 1000;
      const nowMs = Date.now();
      const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
      const windowStartedAt = new Date(windowStartMs);

      for (let attempt = 0; ; attempt += 1) {
        try {
          // Conditional upsert and count in one transaction: the increment happens inside the
          // UPDATE, so the row each attempt reads back is its own post-increment value. Two
          // concurrent attempts can never both see "under the limit" at the boundary.
          const window = await db.$transaction((tx) =>
            tx.rateLimitWindow.upsert({
              where: { key_windowStartedAt: { key, windowStartedAt } },
              create: { key, windowStartedAt, attempts: 1 },
              update: { attempts: { increment: 1 } },
            }),
          );

          if (window.attempts <= limit.attempts) {
            return { allowed: true, retryAfterSeconds: 0 };
          }
          const remainingMs = windowStartMs + windowMs - Date.now();
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
          };
        } catch (error) {
          // When the engine takes the create path twice for a brand-new window, the loser meets
          // the unique index. That is not an outcome, it is a retry: the second pass upserts
          // onto the winner's row and counts there. P2034 (a transaction write conflict) is the
          // same story with a different code.
          const code = (error as { code?: unknown }).code;
          if ((code === 'P2002' || code === 'P2034') && attempt < 3) continue;
          throw error;
        }
      }
    },

    async clear(key) {
      // Called after a successful sign-in, so a streak of typos is forgiven. Every window row
      // for the key goes — the current one because it is the only one that can block, and any
      // older ones because keeping them is keeping garbage.
      await db.rateLimitWindow.deleteMany({ where: { key } });
    },
  };

  return limiter;
}
