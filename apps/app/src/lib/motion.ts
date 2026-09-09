'use client';

import { duration, spring, stagger } from '@oneresi/ui';

/**
 * The one motion contract for this app.
 *
 * framer-motion is not a dependency here — it belongs to @oneresi/ui, whose components do their
 * own animation. What moves at the app level (screens, rows, verdicts) is CSS keyframes declared
 * once in globals.css, and this module is the only place that decides which class, which
 * duration, and which delay — every animated component goes through here, so
 * prefers-reduced-motion is honoured in exactly one place (the hook below) and the spring
 * parameters exist in exactly one set.
 */

/** The shared spring: mass 1.6, stiffness 220, damping 26. Screens and sheets weigh this much. */
export const SPRING = spring.heavy;

export const DURATION = duration;
export const STAGGER = stagger;

/**
 * How long the shared spring takes to settle, in milliseconds, from a unit distance. A real
 * numerical integration of m·x'' = -k·x - c·x' until the oscillation is within 1% — the CSS
 * keyframes approximate the same curve with an overshooting cubic-bezier, and this number keeps
 * any JavaScript-driven settle (pull-to-refresh release, a drag handoff) on the same clock.
 */
export function springSettleMs(s = SPRING, tolerance = 0.01, maxMs = 2000): number {
  const step = 1 / 240; // 240 Hz; finer than any display involved
  let position = 1;
  let velocity = 0;
  let elapsed = 0;
  while (elapsed < maxMs) {
    const force = (-s.stiffness * (position - 1) - s.damping * velocity) / s.mass;
    velocity += force * step;
    position += velocity * step;
    elapsed += step * 1000;
    if (velocity * velocity < tolerance * tolerance && Math.abs(position - 1) < tolerance) {
      return Math.round(elapsed);
    }
  }
  return maxMs;
}

export type ScreenDirection = 'forward' | 'back' | 'none';

/** The class a screen mounts with. Reduced motion collapses travel to a quick fade — never nothing. */
export function screenClass(direction: ScreenDirection, reduced: boolean): string {
  if (reduced || direction === 'none') return 'screen-in-fade';
  return direction === 'back' ? 'screen-in-back' : 'screen-in-forward';
}

/** The inline style a list row mounts with: 24 ms per row, capped at eight, zero when reduced. */
export function rowStyle(index: number, reduced: boolean): { animationDelay: string } {
  const capped = Math.min(index, STAGGER.cap);
  return { animationDelay: reduced ? '0ms' : `${capped * STAGGER.step}ms` };
}

/** The class a changed row flashes once with — an acknowledgement, in the status tone. */
export const ROW_FLASH_CLASS = 'tone-wash';

/** The class a failed row springs back with: 6px, three diminishing passes. */
export const ROW_SHAKE_CLASS = 'row-shake';

/** The gate verdict. Admit travels and lands heavy; refuse drops a short distance and stops dead. */
export function verdictClass(verdict: 'ADMIT' | 'REFUSE', reduced: boolean): string {
  if (reduced) return 'screen-in-fade';
  return verdict === 'ADMIT' ? 'verdict-admit' : 'verdict-refuse';
}
