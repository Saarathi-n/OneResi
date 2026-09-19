import type { Tone } from '@grihaone/contracts';

/**
 * Tone to classes. A tone is supplied by the enumeration descriptor in `@grihaone/contracts`,
 * so no component chooses a colour for a value and a unit type can never render as a warning.
 */

/** A tinted fill with the tone as text. The default for a pill. */
export const toneSoftClass: Readonly<Record<Tone, string>> = {
  neutral: 'bg-surface-sunken text-content-muted border-border',
  info: 'bg-info-soft text-info border-info-border',
  positive: 'bg-positive-soft text-positive border-positive-border',
  caution: 'bg-caution-soft text-caution border-caution-border',
  critical: 'bg-critical-soft text-critical border-critical-border',
};

/** A solid fill, for the one item on screen that must be seen from a distance. */
export const toneSolidClass: Readonly<Record<Tone, string>> = {
  neutral: 'bg-content-muted text-content-inverse border-content-muted',
  info: 'bg-info text-info-on border-info',
  positive: 'bg-positive text-positive-on border-positive',
  caution: 'bg-caution text-caution-on border-caution',
  critical: 'bg-critical text-critical-on border-critical',
};

/** Text and icons only. */
export const toneTextClass: Readonly<Record<Tone, string>> = {
  neutral: 'text-content-muted',
  info: 'text-info',
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
};

/** The 8px status dot and the leading rule on a card. */
export const toneMarkClass: Readonly<Record<Tone, string>> = {
  neutral: 'bg-content-subtle',
  info: 'bg-info',
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
};
