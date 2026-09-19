'use client';

import type { ReactNode } from 'react';
import { OtpInput } from '@grihaone/ui';

/**
 * Code entry for someone holding a phone in one hand and squinting in daylight. The six segments
 * are the display; the on-screen keypad is the input, sized for a thumb, with no hover state and
 * no drag target smaller than a fingertip. The OtpInput stays the single source of truth for the
 * value — typing into a segment works too — but the keypad is what the guard actually uses.
 */

export const CODE_LENGTH = 6;

interface CodeKeypadProps {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly pending?: boolean | undefined;
  readonly invalid?: boolean | undefined;
}

type Key =
  | { readonly kind: 'digit'; readonly id: string; readonly label: string }
  | { readonly kind: 'clear' }
  | { readonly kind: 'delete' };

const KEYS: readonly Key[] = [
  { kind: 'digit', id: '1', label: '1' },
  { kind: 'digit', id: '2', label: '2' },
  { kind: 'digit', id: '3', label: '3' },
  { kind: 'digit', id: '4', label: '4' },
  { kind: 'digit', id: '5', label: '5' },
  { kind: 'digit', id: '6', label: '6' },
  { kind: 'digit', id: '7', label: '7' },
  { kind: 'digit', id: '8', label: '8' },
  { kind: 'digit', id: '9', label: '9' },
  { kind: 'clear' },
  { kind: 'digit', id: '0', label: '0' },
  { kind: 'delete' },
];

const DIGIT_KEY_CLASS =
  'tab-target h-16 rounded-xl border border-border-strong bg-surface-raised ' +
  'text-[28px] font-semibold leading-none text-content active:bg-surface-sunken focus-ring';
const UTILITY_KEY_CLASS =
  'tab-target h-16 rounded-xl border border-border bg-surface-raised ' +
  'type-body font-medium text-content-subtle active:bg-surface-sunken focus-ring';

export function CodeKeypad({
  value,
  onValueChange,
  pending = false,
  invalid = false,
}: CodeKeypadProps): ReactNode {
  function press(key: Key): void {
    if (pending) return;
    if (key.kind === 'digit') {
      if (value.length < CODE_LENGTH) onValueChange(value + key.id);
      return;
    }
    if (key.kind === 'clear') {
      onValueChange('');
      return;
    }
    onValueChange(value.slice(0, -1));
  }

  return (
    <div>
      <OtpInput
        length={CODE_LENGTH}
        size="kiosk"
        value={value}
        onValueChange={onValueChange}
        pending={pending}
        invalid={invalid}
        label="Pass code"
      />
      <div className="mt-6 grid grid-cols-3 gap-3">
        {KEYS.map((key) => {
          if (key.kind === 'digit') {
            return (
              <button
                key={`key-${key.id}`}
                type="button"
                disabled={pending}
                aria-label={`Digit ${key.label}`}
                className={DIGIT_KEY_CLASS}
                onClick={() => {
                  press(key);
                }}
              >
                {key.label}
              </button>
            );
          }
          const label = key.kind === 'clear' ? 'Clear' : 'Delete';
          return (
            <button
              key={`key-${key.kind}`}
              type="button"
              disabled={pending || value.length === 0}
              aria-label={key.kind === 'clear' ? 'Clear the code' : 'Delete the last digit'}
              className={UTILITY_KEY_CLASS}
              onClick={() => {
                press(key);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
