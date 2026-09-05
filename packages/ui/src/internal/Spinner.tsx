import type { ReactNode } from 'react';
import { cn } from './cn.js';

/**
 * The busy indicator. A ring rather than a swapped label, so the control keeps its width and a
 * pending button does not resize the row it sits in.
 */
export function Spinner({
  size = 16,
  className,
}: {
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      focusable={false}
      className={cn('spinner shrink-0', className)}
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
