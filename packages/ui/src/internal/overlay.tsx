'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, RefObject } from 'react';

/**
 * What a modal surface needs and the previous build had none of: a portal, a counted scroll
 * lock, a real focus trap, and focus restored to whatever opened it.
 */

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Portal({ children }: { children: ReactNode }): ReactNode {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = document.createElement('div');
    element.setAttribute('data-grihaone-portal', '');
    document.body.appendChild(element);
    setHost(element);
    return () => {
      element.remove();
    };
  }, []);

  return host === null ? null : createPortal(children, host);
}

/**
 * Counted, and it restores the value it found instead of writing `unset`. Two overlapping
 * surfaces no longer unlock the page when the inner one closes.
 */
let scrollLocks = 0;
let scrollRestore: string | null = null;

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;

    if (scrollLocks === 0) {
      scrollRestore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLocks += 1;

    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) {
        document.body.style.overflow = scrollRestore ?? '';
        scrollRestore = null;
      }
    };
  }, [active]);
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' &&
      (element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement),
  );
}

export interface FocusTrapOptions {
  /** Escape closes by default. Pass nothing to keep the surface open on Escape. */
  readonly onEscape?: (() => void) | undefined;
  /** Focused on open. Without it, the first focusable child takes focus. */
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Tab and Shift+Tab cycle inside `container` while `active`, Escape calls back, and on close
 * focus returns to the element that had it — including when that element was inside another
 * surface that is still open.
 */
export function useFocusTrap(
  active: boolean,
  container: RefObject<HTMLElement | null>,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus } = options;
  // The escape callback is followed through a ref, not a dependency: it is rebuilt by every
  // consumer render (an inline arrow to their state setter), and a keystroke in a field inside
  // the dialog re-renders the consumer — if the callback were a dependency, the trap would tear
  // down and re-run on every keystroke, re-focusing the first focusable child and yanking the
  // cursor out of the field being typed in.
  const onEscapeRef = useRef<(() => void) | undefined>(options.onEscape);
  onEscapeRef.current = options.onEscape;

  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const root = container.current;
    if (root === null) return undefined;

    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = initialFocus?.current ?? focusableWithin(root)[0] ?? root;
    if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && onEscapeRef.current !== undefined) {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab' || root === null) return;

      const focusable = focusableWithin(root);
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === root)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
        return;
      }
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const restore = returnTo.current;
      returnTo.current = null;
      if (restore !== null && document.contains(restore)) restore.focus({ preventScroll: true });
    };
  }, [active, container, initialFocus]);
}

