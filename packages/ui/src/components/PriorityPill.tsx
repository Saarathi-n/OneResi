import type { ReactNode } from 'react';
import { COMPLAINT_PRIORITIES, COMPLAINT_PRIORITY } from '@grihaone/contracts';
import type { ComplaintPriority } from '@grihaone/contracts';
import { cn } from '../internal/cn.js';
import { toneMarkClass, toneSoftClass } from '../internal/tone.js';

/**
 * Priority, which is not status.
 *
 * They were one component before, so `MEDIUM` arrived as informational blue through something
 * named for status and `HIGH` as danger red. This one reads as a level: four rungs, filled to
 * the priority, with the label beside them. A reader who cannot separate the tones can still
 * count the rungs.
 */
export interface PriorityPillProps {
  readonly priority: ComplaintPriority;
  readonly size?: 'sm' | 'md' | undefined;
  /** Rungs only, for a dense table cell where the column header already says what it is. */
  readonly compact?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

const RUNGS = COMPLAINT_PRIORITIES.length;
export function PriorityPill({
  priority,
  size = 'md',
  compact = false,
  pending = false,
  disabled = false,
  className,
}: PriorityPillProps): ReactNode {
  const descriptor = COMPLAINT_PRIORITY[priority];
  const level = COMPLAINT_PRIORITIES.indexOf(priority) + 1;

  const rungs = (
    <span className="flex items-end gap-0.5" aria-hidden>
      {Array.from({ length: RUNGS }, (_unused, index) => (
        <span
          key={index}
          className={cn(
            'w-1 rounded-xs',
            index < level ? toneMarkClass[descriptor.tone] : 'bg-border-strong',
          )}
          style={{ height: 4 + index * 2 }}
        />
      ))}
    </span>
  );

  if (compact) {
    return (
      <span
        className={cn('inline-flex items-center', disabled ? 'opacity-55' : undefined, className)}
        title={descriptor.label}
      >
        {rungs}
        <span className="sr-only">{descriptor.label}</span>
      </span>
    );
  }

  return (
    <span
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-pill border align-middle',
        size === 'sm' ? 'type-micro px-2 py-0.5' : 'type-label px-2.5 py-1',
        toneSoftClass[descriptor.tone],
        pending ? 'shimmer' : undefined,
        disabled ? 'opacity-55' : undefined,
        className,
      )}
    >
      {rungs}
      {descriptor.label}
    </span>
  );
}
