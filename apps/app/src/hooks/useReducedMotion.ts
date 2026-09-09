'use client';

import { useEffect, useState } from 'react';

/**
 * The one place this app reads `prefers-reduced-motion`. Every animated component asks this hook
 * — none of them queries matchMedia itself — so the preference is applied consistently and a
 * future change (a setting in the profile, for instance) is a one-file change.
 *
 * Server rendering assumes motion is fine and the first client paint corrects it, which is the
 * safe default both ways: a person who asked for less movement sees one quick fade, never a
 * dropped transition.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    function onChange(event: MediaQueryListEvent): void {
      setReduced(event.matches);
    }
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  return reduced;
}
