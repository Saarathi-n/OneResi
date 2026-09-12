'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Tone } from '@grihaone/contracts';
import { cn } from '../internal/cn.js';
import { toneMarkClass } from '../internal/tone.js';
import { toastVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';

/**
 * Feedback, with an undo where the action can be taken back.
 *
 * This replaces `alert()` and `confirm()`. A native dialog blocks the page, cannot be styled,
 * looks different on every platform, and on an installed application it reads as a browser
 * error rather than a response to what the person just did.
 */
export interface ToastOptions {
  readonly title: string;
  readonly description?: string | undefined;
  readonly tone?: Tone | undefined;
  /** Milliseconds on screen. Zero keeps it until it is dismissed. */
  readonly duration?: number | undefined;
  /** Reverses the action. Its presence is what turns the toast into an undo affordance. */
  readonly undo?: (() => void) | undefined;
  readonly undoLabel?: string | undefined;
}

interface ToastRecord extends ToastOptions {
  readonly id: string;
}

export interface ToastApi {
  readonly show: (options: ToastOptions) => string;
  readonly dismiss: (id: string) => void;
  readonly dismissAll: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast requires a ToastProvider above it in the tree.');
  }
  return api;
}

/** Long enough to read and to reach the undo, short enough not to sit there. */
const DEFAULT_DURATION = 6000;

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** How many are on screen at once before the oldest is retired. */
  readonly limit?: number | undefined;
  readonly className?: string | undefined;
}

export function ToastProvider({ children, limit = 3, className }: ToastProviderProps): ReactNode {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const sequence = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      sequence.current += 1;
      const id = `toast-${sequence.current}`;
      setToasts((current) => [...current, { ...options, id }].slice(-limit));
      return id;
    },
    [limit],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss, dismissAll }), [show, dismiss, dismissAll]);

  const urgent = toasts.filter((toast) => toast.tone === 'critical');
  const ordinary = toasts.filter((toast) => toast.tone !== 'critical');
  return (
    <ToastContext.Provider value={api}>
      {children}

      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 p-4',
          'sm:items-end',
          className,
        )}
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Two regions, because a failure has to interrupt and a confirmation must not. */}
        <div role="status" aria-live="polite" className="flex w-full flex-col items-center gap-2 sm:items-end">
          <AnimatePresence initial={false}>
            {ordinary.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </AnimatePresence>
        </div>

        <div role="alert" aria-live="assertive" className="flex w-full flex-col items-center gap-2 sm:items-end">
          <AnimatePresence initial={false}>
            {urgent.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  readonly toast: ToastRecord;
  readonly onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps): ReactNode {
  const motionTokens = useMotion();
  const [held, setHeld] = useState(false);
  const life = toast.duration ?? DEFAULT_DURATION;

  /* Hovering or focusing holds it open. Leaving restarts the countdown from the top, which is
     the behaviour someone reaching for the undo expects. */
  useEffect(() => {
    if (life <= 0 || held) return undefined;
    const timer = window.setTimeout(() => onDismiss(toast.id), life);
    return () => {
      window.clearTimeout(timer);
    };
  }, [life, held, onDismiss, toast.id]);

  const tone = toast.tone ?? 'neutral';

  return (
    <motion.div
      layout
      variants={toastVariants(motionTokens)}
      initial="hidden"
      animate="shown"
      exit="exit"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border',
        'border-border bg-surface-raised p-3 shadow-e3',
      )}
    >
      <span
        className={cn('mt-1.5 size-2 shrink-0 rounded-pill', toneMarkClass[tone])}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="type-body font-medium text-content">{toast.title}</p>
        {toast.description !== undefined ? (
          <p className="type-label text-content-muted">{toast.description}</p>
        ) : null}

        {toast.undo !== undefined ? (
          <div className="mt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                toast.undo?.();
                onDismiss(toast.id);
              }}
            >
              {toast.undoLabel ?? 'Undo'}
            </Button>
          </div>
        ) : null}
      </div>

      <IconButton
        label="Dismiss"
        size="sm"
        icon={<X size={14} aria-hidden />}
        onClick={() => onDismiss(toast.id)}
      />
    </motion.div>
  );
}
