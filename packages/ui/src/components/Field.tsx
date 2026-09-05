'use client';

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Spinner } from '../internal/Spinner.js';

/**
 * Label, control, hint and error, wired together once.
 *
 * The control reads its id and its `aria-describedby` from this context, so a hint and an error
 * are announced without every form remembering to connect them — which is the failure mode the
 * previous build had everywhere: error text rendered as a loose paragraph that a screen reader
 * never associated with the input it belonged to.
 */
export interface FieldControl {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly required: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** Consumed by every control in this package. Null when the control stands on its own. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  readonly label: ReactNode;
  /** Shown under the control. Say what a valid answer looks like, not what went wrong. */
  readonly hint?: ReactNode | undefined;
  /** Present means invalid. Announced politely, and it replaces nothing — the hint stays. */
  readonly error?: ReactNode | undefined;
  readonly required?: boolean | undefined;
  /** Marks the field optional in words rather than leaving the reader to infer it. */
  readonly optional?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** An asynchronous check is running — an availability lookup, for instance. */
  readonly pending?: boolean | undefined;
  /** `group` for a control made of several inputs, such as a segmented code field. */
  readonly as?: 'label' | 'group' | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  pending = false,
  as = 'label',
  className,
  children,
}: FieldProps): ReactNode {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const labelId = `${base}-label`;

  const invalid = error !== undefined && error !== null && error !== false;
  const describedBy =
    [hint !== undefined && hint !== null ? hintId : null, invalid ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined;

  const control: FieldControl = {
    id: controlId,
    describedBy,
    invalid,
    disabled,
    pending,
    required,
  };

  const heading = (
    <span className="flex items-center gap-2">
      <span className="type-label text-content">{label}</span>
      {required ? (
        <span className="type-label text-critical" aria-hidden>
          *
        </span>
      ) : null}
      {optional && !required ? (
        <span className="type-label text-content-subtle">optional</span>
      ) : null}
      {pending ? <Spinner size={13} className="text-content-subtle" /> : null}
    </span>
  );
  return (
    <FieldContext.Provider value={control}>
      <div
        className={cn('flex flex-col gap-1.5', disabled ? 'opacity-60' : undefined, className)}
        aria-busy={pending}
        {...(as === 'group' ? { role: 'group', 'aria-labelledby': labelId } : {})}
      >
        {as === 'group' ? (
          <span id={labelId}>{heading}</span>
        ) : (
          <label htmlFor={controlId} className="w-fit cursor-pointer">
            {heading}
          </label>
        )}

        {children}

        {hint !== undefined && hint !== null ? (
          <p id={hintId} className="type-label text-content-subtle">
            {hint}
          </p>
        ) : null}

        {/* Always mounted, so a value arriving after a failed submit is announced rather than
            appearing silently when the node is inserted. */}
        <p
          id={errorId}
          aria-live="polite"
          className={cn('type-label text-critical', invalid ? undefined : 'sr-only')}
        >
          {invalid ? error : ''}
        </p>
      </div>
    </FieldContext.Provider>
  );
}

