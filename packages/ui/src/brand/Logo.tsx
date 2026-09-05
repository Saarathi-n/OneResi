import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { MARK_PATH, MARK_VIEW_BOX, WORDMARK } from './mark.js';

/**
 * The only place the mark appears in code. Four hand-rolled copies is how a logo ends up in
 * four sizes with three shadows.
 */
export interface LogoProps {
  /** `mark` is the house alone; `wordmark` sets it beside the product name. */
  readonly variant?: 'mark' | 'wordmark' | undefined;
  /** Edge length of the mark in pixels. The word scales with it. */
  readonly size?: number | undefined;
  /**
   * `brand` paints the mark in the accent and the word in body colour. `inherit` takes the
   * surrounding text colour, which is what a dark hero or a single-colour footer wants.
   */
  readonly tone?: 'brand' | 'inherit' | undefined;
  /** Accessible name. Ignored when `decorative`. */
  readonly label?: string | undefined;
  /** True when the name is already beside it, so the mark should not be announced twice. */
  readonly decorative?: boolean | undefined;
  readonly className?: string | undefined;
}

export function Logo({
  variant = 'mark',
  size = 24,
  tone = 'brand',
  label = WORDMARK,
  decorative = false,
  className,
}: LogoProps): ReactNode {
  const markTone = tone === 'brand' && variant === 'mark' ? 'text-accent' : undefined;

  const mark = (
    <svg
      viewBox={MARK_VIEW_BOX}
      width={size}
      height={size}
      fill="none"
      className={cn('shrink-0', markTone, variant === 'mark' ? className : undefined)}
      {...(decorative || variant === 'wordmark'
        ? { 'aria-hidden': true, focusable: false }
        : { role: 'img', 'aria-label': label })}
    >
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
  if (variant === 'mark') return mark;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2',
        tone === 'brand' ? 'text-accent' : undefined,
        className,
      )}
      {...(decorative ? { 'aria-hidden': true } : {})}
    >
      {mark}
      <span
        className={cn('type-title font-semibold', tone === 'brand' ? 'text-content' : undefined)}
        style={{ fontSize: Math.round(size * 0.82), letterSpacing: '-0.02em' }}
      >
        {WORDMARK}
      </span>
    </span>
  );
}
