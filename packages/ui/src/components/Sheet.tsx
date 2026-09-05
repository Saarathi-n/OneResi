'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Portal, useFocusTrap, useScrollLock } from '../internal/overlay.js';
import { spring } from '../tokens.js';
import { backdropVariants, sheetVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';

/**
 * The phone-shaped modal. It comes up from below on the heaviest spring in the system, and a
 * thumb can throw it back down — the release velocity is handed to the same spring, so a flick
 * continues instead of stopping dead at the moment the finger lifts.
 */
export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  /** `auto` hugs its content, `tall` takes most of the screen, `full` takes all of it. */
  readonly height?: 'auto' | 'tall' | 'full' | undefined;
  readonly pending?: boolean | undefined;
  readonly dismissOnBackdrop?: boolean | undefined;
  readonly dismissOnEscape?: boolean | undefined;
  readonly dragToDismiss?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}

const HEIGHT: Readonly<Record<'auto' | 'tall' | 'full', string>> = {
  auto: 'max-h-[85vh]',
  tall: 'h-[85vh]',
  full: 'h-[100vh] rounded-none',
};

/** Past this much travel, or this much speed, the sheet is going away. */
const DISMISS_OFFSET = 120;
const DISMISS_VELOCITY = 600;
export function Sheet({
  open,
  onClose,
  title,
  description,
  footer,
  height = 'auto',
  pending = false,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  dragToDismiss = true,
  className,
  children,
}: SheetProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = `${base}-description`;
  const motionTokens = useMotion();

  const dismissable = !pending;

  useScrollLock(open);
  useFocusTrap(open, panel, {
    onEscape: dismissable && dismissOnEscape ? onClose : undefined,
  });

  function onDragEnd(_event: unknown, info: PanInfo): void {
    if (!dismissable) return;
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) onClose();
  }

  return (
    <Portal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <motion.div
              className="absolute inset-0 bg-overlay"
              variants={backdropVariants(motionTokens, 'base')}
              initial="hidden"
              animate="shown"
              exit="exit"
              onClick={dismissable && dismissOnBackdrop ? onClose : undefined}
              aria-hidden
            />
            <motion.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description === undefined ? undefined : descriptionId}
              aria-busy={pending}
              variants={sheetVariants(motionTokens)}
              initial="hidden"
              animate="shown"
              exit="exit"
              drag={dragToDismiss && dismissable ? 'y' : false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.7 }}
              dragTransition={{
                bounceStiffness: spring.heavy.stiffness,
                bounceDamping: spring.heavy.damping,
              }}
              onDragEnd={onDragEnd}
              style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
              className={cn(
                'relative flex w-full max-w-xl flex-col gap-3 rounded-t-2xl',
                'border border-b-0 border-border bg-surface-raised px-4 pt-3 shadow-e4',
                HEIGHT[height],
                className,
              )}
            >
              {dragToDismiss && dismissable ? (
                <span
                  className="mx-auto h-1.5 w-10 shrink-0 rounded-pill bg-border-strong"
                  aria-hidden
                />
              ) : null}

              <div className="flex flex-col gap-1">
                <h2 id={titleId} className="type-title text-content">
                  {title}
                </h2>
                {description !== undefined ? (
                  <p id={descriptionId} className="type-body text-content-muted">
                    {description}
                  </p>
                ) : null}
              </div>

              <div className="overscroll-trap type-body flex-1 overflow-y-auto text-content">
                {children}
              </div>

              {footer !== undefined ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
                  {footer}
                </div>
              ) : null}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </Portal>
  );
}
