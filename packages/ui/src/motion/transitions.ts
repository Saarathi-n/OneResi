'use client';

import type { TargetAndTransition, Transition, Variants } from 'framer-motion';
import type { GateVerdict } from '@oneresi/contracts';
import { duration, seconds } from '../tokens.js';
import type { Motion } from './useMotion.js';

/**
 * The choreography, once, as reusable variants.
 *
 * Every factory takes the `Motion` object from `useMotion()` and asks it for distances and
 * transitions, so the reduced-motion contract is honoured by construction rather than by each
 * caller remembering it. Where a variant would have nothing left to animate once travel and
 * scale collapse, this module substitutes opacity — that substitution is the one thing it is
 * allowed to know about the preference, and it is why nothing here can become a silent swap.
 */

export type NavDirection = 'forward' | 'back';

interface PageStates {
  readonly initial: TargetAndTransition;
  readonly enter: TargetAndTransition;
  readonly exit: TargetAndTransition;
}

/**
 * Screen to screen. Weight lives in the spring's mass, not in the duration: the incoming screen
 * accelerates slowly, overshoots slightly, settles, and carries elevation 2 while it is in
 * transit before it lands flat. The outgoing screen scales back and fades out behind it.
 *
 * Not a cross-fade. A fade has no direction, and a back gesture that animates forward is the
 * tell that there is no navigation model underneath.
 */
function pageStates(m: Motion, direction: NavDirection): PageStates {
  const arrive = m.travel('mid');
  const depart = m.travel('near');
  const back = direction === 'back';

  return {
    initial: {
      x: back ? -arrive : arrive,
      scale: m.scale(0.995),
      /* Full motion arrives at full opacity — the movement is the transition. Under the
         preference there is no movement, so opacity has to become the transition. */
      opacity: m.reduced ? 0 : 1,
      boxShadow: m.elevation(2),
    },
    enter: {
      x: 0,
      scale: 1,
      opacity: 1,
      boxShadow: m.elevation(0),
      transition: { ...m.spring('heavy'), boxShadow: m.tween('base') },
    },
    exit: {
      x: back ? depart : -depart,
      scale: m.scale(0.98),
      opacity: 0,
      boxShadow: m.elevation(2),
      transition: { ...m.spring('heavy'), opacity: m.tween('base') },
    },
  };
}

/**
 * Direction-aware variants. Pass `'forward'` or `'back'` as `custom` on the animating element
 * — usually from the router, which is the only thing that knows which way the visitor went.
 * `enter` is the same either way; only the approach and the departure mirror.
 */
export function pageVariants(m: Motion): Variants {
  return {
    initial: (direction: NavDirection) => pageStates(m, direction).initial,
    enter: pageStates(m, 'forward').enter,
    exit: (direction: NavDirection) => pageStates(m, direction).exit,
  };
}

/** The same choreography with the direction fixed. */
export function pageForward(m: Motion): Variants {
  return { ...pageStates(m, 'forward') };
}

/** The exact inverse of `pageForward`. */
export function pageBack(m: Motion): Variants {
  return { ...pageStates(m, 'back') };
}

/** The scrim. A sheet's backdrop settles at `base`, a dialog's at `quick`. */
export function backdropVariants(m: Motion, speed: 'base' | 'quick' = 'base'): Variants {
  return {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: m.tween(speed) },
    exit: { opacity: 0, transition: m.tween('quick') },
  };
}

/**
 * A bottom sheet is the heaviest thing in the product: it comes up from below on a `heavy`
 * spring and it is the one surface a thumb can throw back down, so the component hands the
 * drag velocity to the same spring on release.
 */
export function sheetVariants(m: Motion): Variants {
  return {
    hidden: m.reduced
      ? { y: 0, opacity: 0 }
      : { y: '100%', opacity: 1, boxShadow: m.elevation(2) },
    shown: {
      y: 0,
      opacity: 1,
      boxShadow: m.elevation(4),
      transition: { ...m.spring('heavy'), opacity: m.tween('quick'), boxShadow: m.tween('base') },
    },
    exit: m.reduced
      ? { y: 0, opacity: 0, transition: m.tween('quick') }
      : { y: '100%', opacity: 1, transition: { ...m.spring('heavy'), opacity: m.tween('quick') } },
  };
}

/** A dialog does not travel — it grows into place at `medium` behind a `quick` scrim. */
export function dialogVariants(m: Motion): Variants {
  return {
    hidden: { opacity: 0, scale: m.scale(0.96), boxShadow: m.elevation(2) },
    shown: {
      opacity: 1,
      scale: 1,
      boxShadow: m.elevation(4),
      transition: { ...m.spring('medium'), opacity: m.tween('quick') },
    },
    exit: {
      opacity: 0,
      scale: m.scale(0.98),
      transition: m.tween('quick'),
    },
  };
}

/** The list itself only fades; the rows are what carry the stagger. */
export function listContainerVariants(m: Motion): Variants {
  return {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: m.tween('quick') },
  };
}

/**
 * One row. Pass the row index as `custom`: the delay is 24 ms per row and stops compounding
 * after the eighth, so the ninth row and everything below it arrive together instead of
 * trickling in for a second and a half.
 */
export function listItemVariants(m: Motion): Variants {
  const rise = m.travel('near');
  return {
    hidden: { opacity: 0, y: rise },
    shown: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { ...m.spring('medium'), delay: m.stagger(index) },
    }),
    exit: { opacity: 0, y: rise, transition: m.tween('quick') },
  };
}

/**
 * A row that changed. Height animates so neighbours are pushed rather than jumped, and the
 * pending state is the 60% shimmer an optimistic update wears until the server agrees.
 */
export function rowMutationVariants(m: Motion): Variants {
  return {
    settled: { opacity: 1, height: 'auto', transition: m.spring('medium') },
    pending: { opacity: 0.6, height: 'auto', transition: m.tween('quick') },
    removed: { opacity: 0, height: 0, transition: { ...m.tween('base'), opacity: m.tween('quick') } },
  };
}

/**
 * The one-shot tone wash over a row that just changed. The component supplies the colour from
 * the enumeration's tone; this only fades an overlay in and out, which is why it survives
 * reduced motion unchanged — it is an acknowledgement, not movement, and removing it would
 * leave the change unannounced.
 */
export function rowFlashVariants(): Variants {
  return {
    idle: { opacity: 0 },
    flash: {
      opacity: [0, 1, 0],
      transition: { duration: seconds(duration.slow), times: [0, 0.22, 1] },
    },
  };
}

/**
 * Failure. Six pixels, three diminishing passes, over `base`. Under the preference the shake
 * becomes a single opacity pulse, because a rejection still has to be felt.
 */
export function shakeVariants(m: Motion): Variants {
  const throwDistance = m.travel(6);

  if (m.reduced) {
    return {
      still: { opacity: 1 },
      shake: { opacity: [1, 0.4, 1], transition: m.tween('quick') },
    };
  }

  return {
    still: { x: 0 },
    shake: {
      x: [0, -throwDistance, throwDistance, -throwDistance * 0.6, throwDistance * 0.6, 0],
      transition: { duration: seconds(duration.base), ease: 'easeInOut' },
    },
  };
}

/** The panel under a tab strip cross-fades; the underline is a shared layout animation. */
export function tabPanelVariants(m: Motion): Variants {
  return {
    hidden: { opacity: 0, y: m.travel('nudge') },
    shown: { opacity: 1, y: 0, transition: m.tween('quick') },
    exit: { opacity: 0, transition: m.tween('instant') },
  };
}

/** For the `layoutId` underline that slides between tabs. */
export function tabUnderlineTransition(m: Motion): Transition {
  return m.spring('medium');
}

/** A toast arrives from below on a light spring and leaves without ceremony. */
export function toastVariants(m: Motion): Variants {
  const rise = m.travel('mid');
  return {
    hidden: { opacity: 0, y: rise, scale: m.scale(0.96) },
    shown: { opacity: 1, y: 0, scale: 1, transition: m.spring('light') },
    exit: { opacity: 0, y: m.travel('near'), scale: m.scale(0.98), transition: m.tween('quick') },
  };
}
/**
 * The gate verdict, which has to be readable from a metre away and has to feel different
 * depending on the answer. Both start with a full-bleed tone wash at `quick`; then the card
 * lands. Admission travels further on the `heavy` spring and is allowed its overshoot. A
 * refusal comes a short distance on the `light` spring, so it arrives sooner and stops dead.
 */
export function gateVerdictVariants(m: Motion, verdict: GateVerdict): Variants {
  const admit = verdict === 'ADMIT';
  const drop = m.travel(admit ? 'mid' : 'nudge');

  return {
    hidden: { opacity: 0, y: -drop, scale: m.scale(admit ? 0.96 : 1.02) },
    shown: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: admit ? m.spring('heavy') : m.spring('light'),
    },
    exit: { opacity: 0, scale: m.scale(0.98), transition: m.tween('quick') },
  };
}

/** The tone wash behind a verdict. Opacity only, so it reads under any preference. */
export function verdictWashVariants(m: Motion): Variants {
  return {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: m.tween('quick') },
    exit: { opacity: 0, transition: m.tween('base') },
  };
}

/**
 * Press and hover feedback for a control. Applied as named variants so the control itself never
 * has to ask whether movement is welcome: under the preference the scale collapses to one and
 * the press is acknowledged by a dip in opacity instead.
 */
export function controlVariants(m: Motion): Variants {
  return {
    rest: { scale: 1, opacity: 1 },
    hover: { scale: m.scale(1.012), opacity: 1, transition: m.spring('light') },
    press: {
      scale: m.scale(0.975),
      opacity: m.reduced ? 0.82 : 1,
      transition: m.spring('light'),
    },
  };
}

/**
 * A pass code appearing. One character at a time at 40 ms, then the card settles. Pass the
 * character index as `custom`.
 */
export function codeRevealVariants(m: Motion): Variants {
  return {
    hidden: { opacity: 0, y: m.travel('nudge'), scale: m.scale(0.88) },
    shown: (index: number) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { ...m.spring('light'), delay: m.stagger(index, 40) },
    }),
  };
}

