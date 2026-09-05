'use client';

import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { CONTROL_BASE, CONTROL_SIZE, controlBorder } from '../internal/control.js';
import type { ControlSize } from '../internal/control.js';
import { useFieldControl } from './Field.js';
import { IconButton } from './IconButton.js';

/**
 * A number, on a numeric keypad, with the arrow keys and a pair of steppers.
 *
 * It carries no currency logic. An amount of money is `Paise` and belongs to `Money`; this is
 * for counts — occupants, hours, a floor.
 */
export interface NumericInputProps {
  readonly value?: number | null | undefined;
  readonly onValueChange?: ((value: number | null) => void) | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly size?: ControlSize | undefined;
  readonly steppers?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly autoComplete?: string | undefined;
  readonly className?: string | undefined;
  /** Required when the control is used without a `Field`. */
  readonly label?: string | undefined;
  /** A unit shown inside the control — "hours", "months". */
  readonly unit?: ReactNode | undefined;
}

function clamp(value: number, min: number | undefined, max: number | undefined): number {
  const lower = min === undefined ? value : Math.max(value, min);
  return max === undefined ? lower : Math.min(lower, max);
}

export function NumericInput({
  value = null,
  onValueChange,
  min,
  max,
  step = 1,
  size = 'md',
  steppers = true,
  pending,
  invalid,
  disabled,
  placeholder,
  name,
  id,
  autoComplete = 'off',
  className,
  label,
  unit,
}: NumericInputProps): ReactNode {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const isPending = pending ?? field?.pending ?? false;
  const isDisabled = disabled ?? field?.disabled ?? false;

  const [text, setText] = useState<string>(value === null ? '' : String(value));

  useEffect(() => {
    setText(value === null ? '' : String(value));
  }, [value]);

  const allowSign = min === undefined || min < 0;
  const allowPoint = !Number.isInteger(step);

  function commit(next: string): void {
    setText(next);
    if (next === '' || next === '-') {
      onValueChange?.(null);
      return;
    }
    const parsed = Number(next);
    if (Number.isNaN(parsed)) return;
    onValueChange?.(parsed);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>): void {
    const raw = event.target.value;
    const pattern = allowSign
      ? allowPoint
        ? /[^0-9.-]/g
        : /[^0-9-]/g
      : allowPoint
        ? /[^0-9.]/g
        : /[^0-9]/g;
    commit(raw.replace(pattern, ''));
  }

  function nudge(direction: 1 | -1): void {
    if (isDisabled || isPending) return;
    const current = value ?? min ?? 0;
    const next = clamp(Number((current + direction * step).toFixed(6)), min, max);
    setText(String(next));
    onValueChange?.(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      nudge(1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      nudge(-1);
    }
  }

  function onBlur(): void {
    if (text === '' || text === '-') return;
    const parsed = Number(text);
    if (Number.isNaN(parsed)) {
      commit('');
      return;
    }
    const bounded = clamp(parsed, min, max);
    setText(String(bounded));
    if (bounded !== parsed) onValueChange?.(bounded);
  }

  const atMin = min !== undefined && value !== null && value <= min;
  const atMax = max !== undefined && value !== null && value >= max;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {steppers ? (
        <IconButton
          label="One less"
          icon={<Minus size={16} aria-hidden />}
          variant="secondary"
          size={size === 'kiosk' ? 'lg' : 'md'}
          onClick={() => nudge(-1)}
          disabled={isDisabled || atMin}
        />
      ) : null}

      <div className="relative flex flex-1 items-center">
        <input
          id={id ?? field?.id}
          name={name}
          type="text"
          inputMode={allowPoint ? 'decimal' : 'numeric'}
          autoComplete={autoComplete}
          value={text}
          placeholder={placeholder}
          disabled={isDisabled}
          required={field?.required}
          aria-invalid={isInvalid || undefined}
          aria-describedby={field?.describedBy}
          aria-busy={isPending}
          {...(label !== undefined ? { 'aria-label': label } : {})}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={cn(
            CONTROL_BASE,
            CONTROL_SIZE[size],
            controlBorder(isInvalid),
            'type-numeric text-right',
            unit !== undefined ? 'pr-16' : undefined,
          )}
        />
        {unit !== undefined ? (
          <span className="pointer-events-none absolute right-3 type-label text-content-subtle">
            {unit}
          </span>
        ) : null}
      </div>

      {steppers ? (
        <IconButton
          label="One more"
          icon={<Plus size={16} aria-hidden />}
          variant="secondary"
          size={size === 'kiosk' ? 'lg' : 'md'}
          onClick={() => nudge(1)}
          disabled={isDisabled || atMax}
        />
      ) : null}
    </div>
  );
}

