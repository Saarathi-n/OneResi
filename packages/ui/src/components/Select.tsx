'use client';

import { ChevronDown } from 'lucide-react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../internal/cn.js';
import { Spinner } from '../internal/Spinner.js';
import { CONTROL_BASE, CONTROL_SIZE, controlBorder } from '../internal/control.js';
import type { ControlSize } from '../internal/control.js';
import { useFieldControl } from './Field.js';

/**
 * A native select. It gets the platform picker on a phone, it is reachable with the keyboard
 * without any help, and it costs nothing to render.
 *
 * `label` on an option is what a person reads — pass the descriptor label from the enumeration,
 * never the stored value.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  /** Why this option cannot be chosen. Shown beside the label rather than hidden. */
  readonly note?: string | undefined;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'children'> {
  readonly options: readonly SelectOption[];
  /** Shown while nothing is chosen. Not selectable once a value exists. */
  readonly placeholder?: string | undefined;
  readonly size?: ControlSize | undefined;
  readonly pending?: boolean | undefined;
  readonly invalid?: boolean | undefined;
}
export function Select({
  options,
  placeholder,
  size = 'md',
  pending,
  invalid,
  className,
  id,
  disabled,
  required,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps): ReactNode {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const isPending = pending ?? field?.pending ?? false;
  const isDisabled = (disabled ?? field?.disabled ?? false) || isPending;

  return (
    <div className="relative flex items-center">
      <select
        id={id ?? field?.id}
        disabled={isDisabled}
        required={required ?? field?.required}
        aria-invalid={isInvalid || undefined}
        aria-describedby={describedBy ?? field?.describedBy}
        aria-busy={isPending}
        className={cn(
          CONTROL_BASE,
          CONTROL_SIZE[size],
          controlBorder(isInvalid),
          'cursor-pointer appearance-none pr-10',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.note === undefined ? option.label : `${option.label} — ${option.note}`}
          </option>
        ))}
      </select>

      <span className="pointer-events-none absolute right-3 flex text-content-subtle">
        {isPending ? <Spinner /> : <ChevronDown size={18} aria-hidden />}
      </span>
    </div>
  );
}
