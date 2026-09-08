'use client';

import { useCallback, useState } from 'react';

/**
 * One state, whether the caller owns it or not. Every control in this package accepts a
 * `value`/`onValueChange` pair and works without either, so a form can drive it from the URL
 * without the component growing a second code path.
 */
export function useControllable<T>(
  controlled: T | undefined,
  fallback: T,
  onChange?: (value: T) => void,
): readonly [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(fallback);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : internal;

  const set = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      if (onChange !== undefined) onChange(next);
    },
    [isControlled, onChange],
  );

  return [value, set];
}
