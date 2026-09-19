'use client';

import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { IconButton } from './IconButton.js';

/**
 * The theme switch, and the hook behind it.
 *
 * The first visit follows the system; the first explicit choice is remembered and wins from
 * then on. What is persisted is a preference, never a requirement — every read is guarded, and
 * the page is fully usable with storage refused.
 *
 * Applications set `data-theme` before first paint with a tiny inline script in the root layout
 * (the dark values live in `tokens.css` and flip on that attribute alone). The script cannot
 * import this module, so it restates `THEME_STORAGE_KEY` — this comment is the pointer between
 * the two, and the key changes here only if it changes there too.
 */

export type ThemeChoice = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'grihaone.theme';

export function systemTheme(): ThemeChoice {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Puts the document on a theme. `light` removes the attribute; the default palette is light. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'dark') {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }
}

function stored(): ThemeChoice | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

export interface Theme {
  readonly theme: ThemeChoice;
  /** Makes an explicit choice: applies it now and remembers it for every visit after. */
  readonly set: (choice: ThemeChoice) => void;
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<ThemeChoice>('light');

  useEffect(() => {
    setTheme(stored() ?? systemTheme());

    // Until an explicit choice exists, the system stays in charge of the room's lighting.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = (event: MediaQueryListEvent): void => {
      if (stored() === null) setTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', followSystem);
    return () => media.removeEventListener('change', followSystem);
  }, []);

  const set = useCallback((choice: ThemeChoice) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Remembering is a convenience, never a requirement.
    }
    applyTheme(choice);
    setTheme(choice);
  }, []);

  return { theme, set };
}

export function ThemeToggle({ className }: { className?: string | undefined }): ReactNode {
  const { theme, set } = useTheme();
  const dark = theme === 'dark';

  return (
    <IconButton
      label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      icon={dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
      variant="ghost"
      onClick={() => set(dark ? 'light' : 'dark')}
      className={cn(className)}
    />
  );
}
