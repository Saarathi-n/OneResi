'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';

/**
 * Where you are and how much is left, as a segmented bar with the step named.
 *
 * Not a percentage: "62% complete" tells a person nothing they can act on, whereas "Step 3 of 4
 * — Password" tells them what they are doing and that they are nearly done.
 */
export interface Step {
  readonly id: string;
  readonly label: string;
  /** One line under the name — what this step asks for. */
  readonly hint?: string | undefined;
}

export interface StepperProps {
  readonly steps: readonly Step[];
  /** Zero-based index of the step being worked on. */
  readonly current: number;
  /** Lets a reader return to a step already completed. Forward is never offered. */
  readonly onStepSelect?: ((index: number) => void) | undefined;
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}
export function Stepper({
  steps,
  current,
  onStepSelect,
  pending = false,
  disabled = false,
  className,
}: StepperProps): ReactNode {
  const active = steps[current];
  const total = steps.length;

  return (
    <nav
      aria-label="Progress"
      aria-busy={pending}
      className={cn('flex flex-col gap-2', disabled ? 'opacity-55' : undefined, className)}
    >
      <ol className="flex items-center gap-1.5">
        {steps.map((step, index) => {
          const done = index < current;
          const isCurrent = index === current;
          const reachable = done && onStepSelect !== undefined && !disabled && !pending;

          const segment = (
            <span
              className={cn(
                'block h-1.5 rounded-pill transition-colors duration-200',
                done || isCurrent ? 'bg-accent' : 'bg-surface-sunken',
                isCurrent ? 'shadow-e1' : undefined,
              )}
            />
          );

          return (
            <li
              key={step.id}
              className="flex-1"
              {...(isCurrent ? { 'aria-current': 'step' } : {})}
            >
              {reachable ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(index)}
                  className="focus-ring block w-full rounded-pill"
                >
                  <span className="sr-only">{`Back to step ${index + 1}, ${step.label}`}</span>
                  {segment}
                </button>
              ) : (
                <>
                  <span className="sr-only">{`Step ${index + 1}, ${step.label}`}</span>
                  {segment}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-baseline gap-2">
        <span className="type-label text-content-subtle">{`Step ${Math.min(current + 1, total)} of ${total}`}</span>
        <span className="type-body font-medium text-content">{active?.label ?? ''}</span>
        {current >= total ? (
          <span className="flex items-center gap-1 type-label text-positive">
            <Check size={14} aria-hidden />
            Done
          </span>
        ) : null}
      </div>

      {active?.hint !== undefined ? (
        <p className="type-label text-content-muted">{active.hint}</p>
      ) : null}
    </nav>
  );
}
