/**
 * The surface every text control shares. One declaration, so an input in a table and an input
 * in a sheet cannot drift into different heights, radii and text sizes.
 */

export const CONTROL_BASE = [
  'w-full bg-surface-raised text-content',
  'placeholder:text-content-subtle',
  'border rounded-pill transition-colors duration-150',
  'focus-ring',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-subtle',
].join(' ');

export type ControlSize = 'sm' | 'md' | 'lg' | 'kiosk';

export const CONTROL_SIZE: Readonly<Record<ControlSize, string>> = {
  sm: 'h-9 px-3 type-input',
  md: 'h-11 px-3.5 type-input',
  lg: 'h-12 px-4 type-input',
  kiosk: 'h-16 px-5 type-title',
};

/** An invalid control is outlined, not merely tinted — tint alone is invisible to some readers. */
export function controlBorder(invalid: boolean): string {
  return invalid
    ? 'border-critical bg-critical-soft'
    : 'border-border-strong hover:border-content-subtle';
}
