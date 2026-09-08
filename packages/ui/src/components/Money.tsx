'use client';

import { motion } from 'framer-motion';
import { formatMoney } from '@oneresi/contracts';
import type { Paise } from '@oneresi/contracts';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { useMotion } from '../motion/useMotion.js';
import { Skeleton } from './Skeleton.js';

/**
 * An amount of money.
 *
 * It takes `Paise` and calls `formatMoney`, and that is the whole of its relationship with
 * arithmetic — it performs none. No division by a hundred, no `toFixed`, no `parseFloat`. A
 * fraction exists in exactly one function in the system and this component calls it.
 *
 * When the amount changes, the digits that changed roll over rather than being replaced, so a
 * payment that lands is visible instead of merely being true.
 */
export interface MoneyProps {
  readonly value: Paise;
  /** Drops the paise on round amounts. For a list, not for a receipt. */
  readonly compact?: boolean | undefined;
  readonly size?: 'body' | 'title' | 'display' | undefined;
  /** Status colouring, for a credit or an overdue balance. */
  readonly tone?: 'default' | 'positive' | 'critical' | undefined;
  readonly pending?: boolean | undefined;
  /** Names the amount for a reader who arrives at it out of context. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

const SIZE: Readonly<Record<'body' | 'title' | 'display', string>> = {
  body: 'type-body',
  title: 'type-title',
  display: 'type-display',
};

const TONE: Readonly<Record<'default' | 'positive' | 'critical', string>> = {
  default: 'text-content',
  positive: 'text-positive',
  critical: 'text-critical',
};
export function Money({
  value,
  compact = false,
  size = 'body',
  tone = 'default',
  pending = false,
  label,
  className,
}: MoneyProps): ReactNode {
  const motionTokens = useMotion();

  if (pending) {
    return (
      <span
        className={cn('inline-flex items-center', SIZE[size], className)}
        aria-busy
        {...(label !== undefined ? { 'aria-label': label } : {})}
      >
        <Skeleton variant="text" width="5ch" />
      </span>
    );
  }

  const text = formatMoney(value, compact ? { compact: true } : undefined);
  const rise = motionTokens.travel('near');

  return (
    <span
      className={cn(
        'type-numeric inline-flex items-baseline whitespace-nowrap tabular-nums',
        SIZE[size],
        TONE[tone],
        className,
      )}
      {...(label !== undefined ? { 'aria-label': `${label}: ${text}` } : {})}
    >
      {/* The amount is announced once, as one string. A per-glyph span would otherwise be read
          out digit by digit, so every glyph below is hidden from readers. */}
      <span className="sr-only">{text}</span>
      {text.split('').map((glyph, index) => (
        <motion.span
          /* eslint-disable-next-line react/no-array-index-key -- an amount's glyphs are fixed
             positions that never reorder; the position is the identity. */
          key={`${index}:${glyph}`}
          aria-hidden
          initial={{ y: rise, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={motionTokens.tween('slow')}
          className="inline-block"
        >
          {glyph === ' ' ? ' ' : glyph}
        </motion.span>
      ))}
    </span>
  );
}
