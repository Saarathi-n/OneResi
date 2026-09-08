'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { shakeVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';
import { useFieldControl } from './Field.js';

/**
 * The gate code field: one box per digit, a numeric keypad, and a paste that lands in every box
 * at once.
 *
 * This is the most-used input in the product and it runs on a tablet at a gate, so it opens the
 * numeric keypad rather than a full keyboard, it accepts the code from the platform's one-time
 * code autofill, and a wrong code shakes rather than silently clearing.
 */
export interface OtpInputProps {
  readonly length?: number | undefined;
  readonly value?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Fired once, when the last digit lands. Submit from here rather than from a button. */
  readonly onComplete?: ((value: string) => void) | undefined;
  readonly size?: 'md' | 'lg' | 'kiosk' | undefined;
  readonly disabled?: boolean | undefined;
  readonly pending?: boolean | undefined;
  readonly invalid?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly name?: string | undefined;
  /** Names the group when the control is used without a `Field`. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

const SEGMENT: Readonly<Record<'md' | 'lg' | 'kiosk', string>> = {
  md: 'size-12 type-code',
  lg: 'size-14 type-code',
  kiosk: 'size-20 type-code-kiosk',
};

export function OtpInput({
  length = 6,
  value = '',
  onValueChange,
  onComplete,
  size = 'md',
  disabled,
  pending,
  invalid,
  autoFocus = false,
  name,
  label,
  className,
}: OtpInputProps): ReactNode {
  const field = useFieldControl();
  const motionTokens = useMotion();
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const announced = useRef(false);

  const isInvalid = invalid ?? field?.invalid ?? false;
  const isPending = pending ?? field?.pending ?? false;
  const isDisabled = (disabled ?? field?.disabled ?? false) || isPending;

  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  const filled = digits.filter((digit) => digit !== '').length;

  useEffect(() => {
    if (value.length < length) announced.current = false;
  }, [value, length]);

  function focusAt(index: number): void {
    const bounded = Math.min(Math.max(index, 0), length - 1);
    boxes.current[bounded]?.focus();
    boxes.current[bounded]?.select();
  }

  function commit(next: string[]): void {
    const joined = next.join('');
    onValueChange?.(joined);
    if (joined.length === length && !announced.current) {
      announced.current = true;
      onComplete?.(joined);
    }
  }

  function fillFrom(index: number, incoming: string): void {
    const next = digits.slice();
    let cursor = index;
    for (const digit of incoming.split('')) {
      if (cursor >= length) break;
      next[cursor] = digit;
      cursor += 1;
    }
    commit(next);
    focusAt(cursor);
  }

  function onChange(index: number, event: ChangeEvent<HTMLInputElement>): void {
    const incoming = event.target.value.replace(/\D/g, '');
    if (incoming === '') return;
    fillFrom(index, incoming);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>, index: number): void {
    const incoming = event.clipboardData.getData('text').replace(/\D/g, '');
    if (incoming === '') return;
    event.preventDefault();
    fillFrom(index, incoming);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    const next = digits.slice();

    switch (event.key) {
      case 'Backspace': {
        event.preventDefault();
        if (next[index] === '') {
          next[Math.max(index - 1, 0)] = '';
          commit(next);
          focusAt(index - 1);
          return;
        }
        next[index] = '';
        commit(next);
        return;
      }
      case 'Delete': {
        event.preventDefault();
        next[index] = '';
        commit(next);
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        focusAt(index - 1);
        return;
      }
      case 'ArrowRight': {
        event.preventDefault();
        focusAt(index + 1);
        return;
      }
      case 'Home': {
        event.preventDefault();
        focusAt(0);
        return;
      }
      case 'End': {
        event.preventDefault();
        focusAt(length - 1);
        return;
      }
      default:
        return;
    }
  }

  return (
    <motion.div
      className={cn('flex flex-col gap-2', className)}
      variants={shakeVariants(motionTokens)}
      initial="still"
      animate={isInvalid ? 'shake' : 'still'}
      {...(field === null && label !== undefined
        ? { role: 'group', 'aria-label': label }
        : {})}
    >
      <div className="flex items-center gap-2" aria-busy={isPending}>
        {digits.map((digit, index) => (
          <input
            /* eslint-disable-next-line react/no-array-index-key -- the boxes are fixed
               positions, not rows of data; the position is the identity. */
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            id={index === 0 ? field?.id : undefined}
            name={index === 0 ? name : undefined}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && index === 0}            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            disabled={isDisabled}
            aria-label={`Digit ${index + 1} of ${length}`}
            aria-invalid={isInvalid || undefined}
            aria-describedby={index === 0 ? field?.describedBy : undefined}
            onChange={(event) => onChange(index, event)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={(event) => onPaste(event, index)}
            onFocus={(event) => event.currentTarget.select()}
            className={cn(
              'focus-ring bg-surface-raised text-content text-center',
              'rounded-lg border transition-colors duration-150',
              'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-subtle',
              isInvalid
                ? 'border-critical bg-critical-soft'
                : digit === ''
                  ? 'border-border-strong'
                  : 'border-accent',
              SEGMENT[size],
            )}
          />
        ))}
      </div>

      {/* Progress, for a reader who cannot see the boxes fill. */}
      <span className="sr-only" aria-live="polite">
        {filled === length
          ? `All ${length} digits entered`
          : `${filled} of ${length} digits entered`}
      </span>
    </motion.div>
  );
}

