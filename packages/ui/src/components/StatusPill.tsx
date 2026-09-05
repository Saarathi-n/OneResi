import type { ReactNode } from 'react';
import type { Descriptor } from '@oneresi/contracts';
import { cn } from '../internal/cn.js';
import { toneMarkClass, toneSoftClass, toneSolidClass } from '../internal/tone.js';

/**
 * A status, rendered from its descriptor.
 *
 * It takes the descriptor rather than the value, so there is no path by which a raw enumeration
 * member reaches the screen and no component has to guess a colour: the label and the tone both
 * come from the enumeration's own map in `@oneresi/contracts`.
 *
 *   <StatusPill descriptor={INVOICE_STATUS[invoice.status]} />
 */
export interface StatusPillProps {
  readonly descriptor: Descriptor;
  /** `solid` for the one status a room has to read from a distance. */
  readonly emphasis?: 'soft' | 'solid' | undefined;
  readonly size?: 'sm' | 'md' | 'lg' | undefined;
  /** Shows the descriptor's explanation as a tooltip where one exists. */
  readonly explain?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

const SIZE: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: 'type-micro px-2 py-0.5 gap-1',
  md: 'type-label px-2.5 py-1 gap-1.5',
  lg: 'type-body px-3 py-1.5 gap-2',
};
export function StatusPill({
  descriptor,
  emphasis = 'soft',
  size = 'md',
  explain = false,
  pending = false,
  disabled = false,
  className,
}: StatusPillProps): ReactNode {
  const solid = emphasis === 'solid';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill border align-middle',
        SIZE[size],
        solid ? toneSolidClass[descriptor.tone] : toneSoftClass[descriptor.tone],
        pending ? 'shimmer' : undefined,
        disabled ? 'opacity-55' : undefined,
        className,
      )}
      aria-busy={pending || undefined}
      {...(explain && descriptor.hint !== undefined ? { title: descriptor.hint } : {})}
    >
      {/* The dot repeats the tone as a shape, so the state is not carried by colour alone. */}
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-pill',
          solid ? 'bg-current opacity-70' : toneMarkClass[descriptor.tone],
        )}
        aria-hidden
      />
      {descriptor.label}
    </span>
  );
}
