'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { Transition } from 'framer-motion';
import { duration, elevation, seconds, spring, stagger, travel } from '../tokens.js';
import type { DurationName, ElevationLevel, SpringWeight, TravelName } from '../tokens.js';

/**
 * The only place in the product that reads `prefers-reduced-motion`.
 *
 * When the preference is set, travel collapses to zero, scale collapses to one, and every
 * spring becomes an opacity tween at `quick`. What it never does is remove the transition: an
 * instant swap with no acknowledgement is worse for vestibular sensitivity than a fast fade,
 * because the change stops being legible. Components ask this hook for a number and get a
 * number; none of them branch on the preference themselves.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/** Decelerating, no overshoot. For anything that is not moving in space. */
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Symmetric, for a cross-fade. */
const EASE_IN_OUT: [number, number, number, number] = [0.4, 0, 0.2, 1];

export interface Motion {
  /** True when the visitor has asked for less movement. */
  readonly reduced: boolean;
  /** A weighted spring, or a `quick` opacity tween. Never an absent transition. */
  readonly spring: (weight: SpringWeight) => Transition;
  /** An eased duration, shortened to `quick` under the preference. */
  readonly tween: (name: DurationName, ease?: 'out' | 'inOut') => Transition;
  /** Pixels of movement, or zero. */
  readonly travel: (distance: TravelName | number) => number;
  /** A scale factor, or one. */
  readonly scale: (factor: number) => number;
  /** Degrees of rotation, or zero. */
  readonly rotate: (degrees: number) => number;
  /** The shadow for an elevation step. */
  readonly elevation: (level: ElevationLevel) => string;
  /** Seconds of delay for row `index`, capped so a long list does not crawl in. */
  readonly stagger: (index: number, stepMs?: number) => number;
  /** Milliseconds for a named duration, for the places that need the raw number. */
  readonly ms: (name: DurationName) => number;
}

export function createMotion(reduced: boolean): Motion {
  const fade: Transition = {
    type: 'tween',
    duration: seconds(duration.quick),
    ease: EASE_OUT,
  };

  return {
    reduced,

    spring: (weight) => (reduced ? fade : { type: 'spring', ...spring[weight] }),

    tween: (name, ease = 'out') => ({
      type: 'tween',
      duration: seconds(reduced ? duration.quick : duration[name]),
      ease: ease === 'inOut' ? EASE_IN_OUT : EASE_OUT,
    }),

    travel: (distance) => {
      if (reduced) return 0;
      return typeof distance === 'number' ? distance : travel[distance];
    },

    scale: (factor) => (reduced ? 1 : factor),

    rotate: (degrees) => (reduced ? 0 : degrees),

    elevation: (level) => elevation[level],

    stagger: (index, stepMs = stagger.step) => {
      if (reduced) return 0;
      const row = Math.min(Math.max(index, 0), stagger.cap - 1);
      return seconds(row * stepMs);
    },

    ms: (name) => (reduced ? duration.quick : duration[name]),
  };
}
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/** The server renders full motion and the client corrects on hydration, which is the only
 * order that works: the preference is not knowable during a server render. */
function readOnServer(): boolean {
  return false;
}

export function useMotion(): Motion {
  const reduced = useSyncExternalStore(subscribe, readPreference, readOnServer);
  return useMemo(() => createMotion(reduced), [reduced]);
}

