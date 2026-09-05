import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';

/**
 * A placeholder with the shape of the thing that is coming. Loading is one of three distinct
 * states — this one — and it is decorative, so it is hidden from readers while the container
 * that owns it carries `aria-busy`.
 */
export interface SkeletonProps {
  readonly variant?: 'text' | 'block' | 'circle' | undefined;
  readonly width?: number | string | undefined;
  readonly height?: number | string | undefined;
  readonly className?: string | undefined;
}

export function Skeleton({
  variant = 'block',
  width,
  height,
  className,
}: SkeletonProps): ReactNode {
  const shape =
    variant === 'circle'
      ? 'rounded-pill'
      : variant === 'text'
        ? 'rounded-sm h-[1em]'
        : 'rounded-lg h-16';

  return (
    <span
      aria-hidden
      className={cn('shimmer block bg-surface-sunken', shape, className)}
      style={{ width, height }}
    />
  );
}

/** Several text lines, the last one short, which is what a paragraph actually looks like. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  readonly lines?: number | undefined;
  readonly className?: string | undefined;
}): ReactNode {
  return (
    <span className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_unused, index) => (
        <Skeleton key={index} variant="text" width={index === lines - 1 ? '55%' : '100%'} />
      ))}
    </span>
  );
}
