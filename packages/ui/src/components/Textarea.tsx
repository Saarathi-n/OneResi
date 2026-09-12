'use client';

import { useId } from 'react';
import type { ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '../internal/cn.js';
import { CONTROL_BASE, controlBorder } from '../internal/control.js';
import { useFieldControl } from './Field.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly pending?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  /** Shows a remaining-characters count wired into the field's description. */
  readonly showCount?: boolean | undefined;
}

export function Textarea({
  pending,
  invalid,
  showCount = false,
  className,
  id,
  disabled,
  required,
  rows = 4,
  maxLength,
  value,
  'aria-describedby': describedBy,
  ...rest
}: TextareaProps): ReactNode {
  const field = useFieldControl();
  const countId = useId();

  const isInvalid = invalid ?? field?.invalid ?? false;
  const isPending = pending ?? field?.pending ?? false;
  const isDisabled = (disabled ?? field?.disabled ?? false) || isPending;

  const counted = showCount && maxLength !== undefined;
  const used = typeof value === 'string' ? value.length : 0;

  const described = [describedBy ?? field?.describedBy, counted ? countId : undefined]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <textarea
        id={id ?? field?.id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        disabled={isDisabled}
        required={required ?? field?.required}
        aria-invalid={isInvalid || undefined}
        aria-describedby={described === '' ? undefined : described}
        aria-busy={isPending}
        className={cn(
          CONTROL_BASE,
          controlBorder(isInvalid),
          // A multi-line control cannot be a pill; the merge lets this rounded-xl win.
          'rounded-xl type-input min-h-24 resize-y px-3.5 py-2.5',
          className,
        )}
        {...rest}
      />
      {counted ? (
        <span id={countId} className="type-label self-end text-content-subtle" aria-live="polite">
          {`${maxLength - used} characters left`}
        </span>
      ) : null}
    </div>
  );
}
