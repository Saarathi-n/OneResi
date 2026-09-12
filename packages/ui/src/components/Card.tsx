'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Tone } from '@grihaone/contracts';
import { cn } from '../internal/cn.js';
import { toneMarkClass } from '../internal/tone.js';
import { controlVariants } from '../motion/transitions.js';
import { useMotion } from '../motion/useMotion.js';

/**
 * The default container. A card is a surface with an edge — not a shadow-only rectangle, which
 * disappears in dark mode.
 */
export interface CardProps {
  /** A status rule down the leading edge, coloured by the enumeration's tone. */
  readonly tone?: Tone | undefined;
  readonly elevation?: 0 | 1 | 2 | undefined;
  readonly padding?: 'none' | 'tight' | 'default' | 'roomy' | undefined;
  /** Waiting on data. The card stays in place and announces itself as busy. */
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Present means the whole card is the action, so it renders as a button. */
  readonly onActivate?: (() => void) | undefined;
  /** Required when `onActivate` is set and the card's text is not a sufficient name. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

const PADDING: Readonly<Record<'none' | 'tight' | 'default' | 'roomy', string>> = {
  none: '',
  tight: 'p-3',
  default: 'p-4',
  roomy: 'p-6',
};

const ELEVATION: Readonly<Record<0 | 1 | 2, string>> = {
  0: 'shadow-e0',
  1: 'shadow-e1',
  2: 'shadow-e2',
};

export function Card({
  tone,
  elevation = 1,
  padding = 'default',
  pending = false,
  disabled = false,
  onActivate,
  label,
  className,
  children,
}: CardProps): ReactNode {
  const motionTokens = useMotion();

  const shell = cn(
    'relative overflow-hidden rounded-xl border border-border bg-surface-raised text-content',
    ELEVATION[elevation],
    PADDING[padding],
    tone !== undefined ? 'pl-5' : undefined,
    pending ? 'cursor-progress opacity-60' : undefined,
    disabled ? 'opacity-55' : undefined,
    className,
  );

  const rule =
    tone === undefined ? null : (
      <span
        className={cn('absolute inset-y-0 left-0 w-1.5', toneMarkClass[tone])}
        aria-hidden
      />
    );

  if (onActivate === undefined) {
    return (
      <div className={shell} aria-busy={pending}>
        {rule}
        {children}
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={pending || disabled ? undefined : onActivate}
      disabled={disabled}
      aria-busy={pending}
      aria-disabled={pending || disabled}
      {...(label !== undefined ? { 'aria-label': label } : {})}
      variants={controlVariants(motionTokens)}
      initial="rest"
      {...(pending || disabled ? {} : { whileHover: 'hover', whileTap: 'press' })}
      className={cn(shell, 'focus-ring w-full text-left hover:border-border-strong')}
    >
      {rule}
      {children}
    </motion.button>
  );
}
export interface CardHeaderProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode | undefined;
  /** Buttons or a status pill, aligned to the trailing edge. */
  readonly actions?: ReactNode | undefined;
  readonly className?: string | undefined;
}

export function CardHeader({ title, subtitle, actions, className }: CardHeaderProps): ReactNode {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="type-title truncate text-content">{title}</h3>
        {subtitle !== undefined ? (
          <p className="type-body text-content-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return <div className={cn('type-body text-content-muted', className)}>{children}</div>;
}

export function CardFooter({
  className,
  children,
}: {
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className={cn(
        'mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

