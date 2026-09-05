'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Portal, useFocusTrap, useScrollLock } from '../internal/overlay.js';
import { backdropVariants, dialogVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';
import { IconButton } from './IconButton.js';

/**
 * A modal with the four things the previous one lacked: `role="dialog"`, `aria-modal`,
 * `aria-labelledby`, and focus that is trapped while it is open and returned to whatever opened
 * it when it closes.
 *
 * A backdrop click can be refused. Discarding a part-filled form because a thumb landed outside
 * the panel is a data-loss bug, not a convenience.
 */
export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  /** One line under the title. Wired as the dialog's description. */
  readonly description?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  readonly size?: 'sm' | 'md' | 'lg' | undefined;
  /** A submission is in flight: dismissal is refused and the panel announces itself as busy. */
  readonly pending?: boolean | undefined;
  readonly dismissOnBackdrop?: boolean | undefined;
  readonly dismissOnEscape?: boolean | undefined;
  readonly closeLabel?: string | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}

const SIZE: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  pending = false,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  closeLabel = 'Close',
  className,
  children,
}: DialogProps): ReactNode {
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

  return (
    <Portal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-overlay"
              variants={backdropVariants(motionTokens, 'quick')}
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
              variants={dialogVariants(motionTokens)}
              initial="hidden"
              animate="shown"
              exit="exit"
              className={cn(
                'relative flex w-full flex-col gap-4 rounded-2xl border border-border',
                'bg-surface-raised p-5 shadow-e4',
                SIZE[size],
                className,
              )}
            >
              <div className="flex items-start justify-between gap-3">
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
                <IconButton
                  label={closeLabel}
                  icon={<X size={18} aria-hidden />}
                  onClick={onClose}
                  disabled={!dismissable}
                />
              </div>

              <div className="overscroll-trap type-body max-h-[70vh] overflow-y-auto text-content">
                {children}
              </div>

              {footer !== undefined ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
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
