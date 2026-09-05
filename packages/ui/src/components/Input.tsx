'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Spinner } from '../internal/Spinner.js';
import { CONTROL_BASE, CONTROL_SIZE, controlBorder } from '../internal/control.js';
import type { ControlSize } from '../internal/control.js';
import { useFieldControl } from './Field.js';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  readonly size?: ControlSize | undefined;
  /** A validating or looking-up state. The value stays editable; the field shows it is working. */
  readonly pending?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  /** Rendered inside the control, before the text. An icon, not a control. */
  readonly leading?: ReactNode | undefined;
  /** Rendered inside the control, after the text. A unit, a suffix, a status. */
  readonly trailing?: ReactNode | undefined;
}

export function Input({
  size = 'md',
  pending,
  invalid,
  leading,
  trailing,
  className,
  id,
  disabled,
  required,
  'aria-describedby': describedBy,
  ...rest
}: InputProps): ReactNode {
  const field = useFieldControl();

  const isInvalid = invalid ?? field?.invalid ?? false;
  const isPending = pending ?? field?.pending ?? false;
  const isDisabled = disabled ?? field?.disabled ?? false;

  const control = (
    <input
      id={id ?? field?.id}
      disabled={isDisabled}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={describedBy ?? field?.describedBy}
      className={cn(
        CONTROL_BASE,
        CONTROL_SIZE[size],
        controlBorder(isInvalid),
        leading !== undefined ? 'pl-10' : undefined,
        trailing !== undefined || isPending ? 'pr-10' : undefined,
        className,
      )}
      {...rest}
    />
  );
  if (leading === undefined && trailing === undefined && !isPending) return control;

  return (
    <div className="relative flex items-center">
      {leading !== undefined ? (
        <span
          className="pointer-events-none absolute left-3 flex text-content-subtle"
          aria-hidden
        >
          {leading}
        </span>
      ) : null}
      {control}
      {isPending ? (
        <span className="pointer-events-none absolute right-3 flex text-content-subtle">
          <Spinner />
        </span>
      ) : (
        trailing !== undefined && (
          <span className="pointer-events-none absolute right-3 flex text-content-subtle">
            {trailing}
          </span>
        )
      )}
    </div>
  );
}
