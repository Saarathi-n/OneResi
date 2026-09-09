/**
 * A webpack-resolution shim for `motion-dom`, wired through `resolve.alias` in next.config.ts.
 *
 * The lockfile pairs framer-motion@12.6.3 with motion-dom@12.43.0. That pair drifted: 12.6.3's
 * ESM imports three symbols from `motion-dom` — `attachTimeline`, `activeAnimations`,
 * `isBezierDefinition` — that 12.43.0 no longer exports (the first became a class method, the
 * counter was dropped, the third moved to `motion-utils`). The packages were re-pinned upstream
 * later, but re-pinning is an install-time change this app cannot make.
 *
 * So the app re-exports the real motion-dom by FILE PATH — the path bypasses the bare-specifier
 * alias, otherwise the shim would re-export itself — and supplies the three missing symbols:
 *
 * - `attachTimeline(animation, timeline)` — in the matched motion-dom this called
 *   `animation.attachTimeline(timeline)` and returned a detach function. 12.43.0 still has the
 *   method; only the standalone wrapper went away.
 * - `activeAnimations` — a `{ mainThread }` counter framer-motion increments and decrements for
 *   its stats surface. Nothing in this app reads it.
 * - `isBezierDefinition(easing)` — `Array.isArray(easing) && typeof easing[0] === 'number'`,
 *   lifted verbatim from motion-utils@12.39.0, which 12.6.3 also depends on but does not import
 *   the symbol from.
 *
 * Scroll-linked timelines are the only feature that touches the wrapper, and nothing in
 * @oneresi/ui uses them. If framer-motion/motion-dom are ever re-pinned, this file and its
 * alias in next.config.ts can be deleted.
 */
// cspell: disable
export * from '../../../../node_modules/.pnpm/motion-dom@12.43.0/node_modules/motion-dom/dist/es/index.mjs';
// cspell: enable

/** Re-attaches a WAAPI animation to another timeline (scroll-driven animations). */
export function attachTimeline(animation, timeline) {
  return typeof animation?.attachTimeline === 'function'
    ? animation.attachTimeline(timeline)
    : () => {};
}

/** Animation counters, written by framer-motion for its stats surface. */
export const activeAnimations = { mainThread: 0 };

/** True when an easing is a cubic-bezier pair rather than a named curve. */
export function isBezierDefinition(easing) {
  return Array.isArray(easing) && typeof easing[0] === 'number';
}
