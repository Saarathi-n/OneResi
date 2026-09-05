import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose classes and let the last utility win.
 *
 * Every component takes `className` and merges it last, so a caller can adjust spacing without
 * re-declaring the component. That is the whole reason the previous interface drifted: with no
 * override seam, each screen restated the entire class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
