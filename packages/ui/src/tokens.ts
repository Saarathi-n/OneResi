import type { Tone } from '@oneresi/contracts';

/**
 * Every number the design system decides, in one module.
 *
 * The colour values live in `tokens.css` because a theme has to flip without a re-render. What
 * is here is what JavaScript has to know: the type steps, and the motion tokens that
 * `framer-motion` consumes directly.
 */

// ---------------------------------------------------------------- type

/**
 * Five steps. `body` is the default; `micro` is for timestamps and needs a justification.
 * `className` is what components apply — the sizes are declared once, in `tokens.css`, and
 * repeated here only so a layout calculation can read them.
 */
export const typeScale = {
  mega: { mobile: 40, desktop: 52, className: 'type-mega' },
  display: { mobile: 28, desktop: 34, className: 'type-display' },
  title: { mobile: 20, desktop: 22, className: 'type-title' },
  body: { mobile: 15, desktop: 16, className: 'type-body' },
  label: { mobile: 13, desktop: 13, className: 'type-label' },
  micro: { mobile: 11, desktop: 11, className: 'type-micro' },
} as const;

export type TypeStep = keyof typeof typeScale;

export function typeClass(step: TypeStep): string {
  return typeScale[step].className;
}

// ---------------------------------------------------------------- motion

/** Milliseconds. Anything that does not move in space uses one of these. */
export const duration = {
  instant: 90,
  quick: 140,
  base: 220,
  slow: 320,
  deliberate: 480,
  /** A figure counting up to its value. Long enough to read, short enough to trust. */
  count: 600,
} as const;

export type DurationName = keyof typeof duration;

/**
 * Weight is mass, not duration. A heavy thing accelerates slowly, overshoots slightly and
 * settles; `damping` under about 28 is what produces the overshoot that reads as momentum.
 * Anything that moves in space uses a spring, never an eased duration.
 */
export const spring = {
  /** Toggles, chips, small affordances. */
  light: { mass: 0.6, stiffness: 420, damping: 32 },
  /** Cards, rows, tabs. */
  medium: { mass: 1.0, stiffness: 300, damping: 30 },
  /** Sheets and whole screens. */
  heavy: { mass: 1.6, stiffness: 220, damping: 26 },
} as const;

export type SpringWeight = keyof typeof spring;

/** Pixels of movement. A transition that travels further needs a heavier spring to stay honest. */
export const travel = {
  nudge: 4,
  near: 8,
  mid: 16,
  far: 32,
} as const;

export type TravelName = keyof typeof travel;

/** Row-to-row delay for a staggered list, and the row after which the rest arrive together. */
export const stagger = {
  step: 24,
  cap: 8,
} as const;

/** `framer-motion` counts in seconds, the tokens count in milliseconds. */
export function seconds(ms: number): number {
  return ms / 1000;
}

// ---------------------------------------------------------------- surfaces

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  pill: 999,
} as const;

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * Elevation as literal shadows rather than custom properties, because a transition has to
 * interpolate between two of them. Every step carries the same two layers in the same order
 * so the interpolation is smooth; the theme-aware equivalents are `shadow-e0` to `shadow-e4`.
 */
export const elevation = [
  '0 0px 0px 0px rgba(0,0,0,0), 0 0px 0px 0px rgba(0,0,0,0)',
  '0 1px 2px -1px rgba(0,0,0,0.10), 0 1px 3px 0px rgba(0,0,0,0.06)',
  '0 4px 8px -2px rgba(0,0,0,0.12), 0 2px 6px 0px rgba(0,0,0,0.07)',
  '0 12px 20px -6px rgba(0,0,0,0.16), 0 6px 12px 0px rgba(0,0,0,0.08)',
  '0 24px 44px -12px rgba(0,0,0,0.22), 0 12px 24px 0px rgba(0,0,0,0.10)',
] as const;

export type ElevationLevel = 0 | 1 | 2 | 3 | 4;
// ---------------------------------------------------------------- tone

/**
 * The four layers a tone needs. `base` is text and icon, `soft` is a fill behind it, `border`
 * is the edge, `on` is what sits legibly on a solid `base` fill.
 *
 * A tone arrives from `@oneresi/contracts` — it is a property of the enumeration member, not a
 * decision a component makes, which is what keeps a unit type from rendering as a warning.
 */
export type ToneLayer = 'base' | 'soft' | 'border' | 'on';

const TONE_VARS: Readonly<Record<Tone, Readonly<Record<ToneLayer, string>>>> = {
  neutral: {
    base: '--content-muted',
    soft: '--surface-sunken',
    border: '--border',
    on: '--content-inverse',
  },
  info: { base: '--info', soft: '--info-soft', border: '--info-border', on: '--info-on' },
  positive: {
    base: '--positive',
    soft: '--positive-soft',
    border: '--positive-border',
    on: '--positive-on',
  },
  caution: {
    base: '--caution',
    soft: '--caution-soft',
    border: '--caution-border',
    on: '--caution-on',
  },
  critical: {
    base: '--critical',
    soft: '--critical-soft',
    border: '--critical-border',
    on: '--critical-on',
  },
} as const;

/** `var(--positive-soft)`. For the places a value has to reach an inline style, such as the
 * one-shot background flash a mutated row plays. */
export function toneVar(tone: Tone, layer: ToneLayer): string {
  return `var(${TONE_VARS[tone][layer]})`;
}

