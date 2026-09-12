import type { ReactNode } from 'react';
import type { Tone } from '@grihaone/contracts';
import { cn } from '../internal/cn.js';
import { toneSoftClass, toneSolidClass } from '../internal/tone.js';

/**
 * A neutral chip: a count, a category, a period. It carries no status meaning — status is
 * `StatusPill` and priority is `PriorityPill`, because one badge doing all three is how a unit
 * type ended up rendering as a warning.
 */
export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: Tone | undefined;
  readonly emphasis?: 'soft' | 'solid' | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  readonly icon?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

export function Badge({
  children,
  tone = 'neutral',
  emphasis = 'soft',
  size = 'md',
  icon,
  disabled = false,
  className,
}: BadgeProps): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border',
        size === 'sm' ? 'type-micro px-2 py-0.5' : 'type-label px-2.5 py-1',
        emphasis === 'solid' ? toneSolidClass[tone] : toneSoftClass[tone],
        disabled ? 'opacity-55' : undefined,
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
