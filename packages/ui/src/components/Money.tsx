'use client';

import { animate, motion } from 'framer-motion';
import { formatMoney, paise } from '@oneresi/contracts';
import type { Paise } from '@oneresi/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { duration, seconds } from '../tokens.js';
import { EASE_OUT, useMotion } from '../motion/useMotion.js';
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
 *
 * With `countUp`, the amount arrives by counting from zero on first render (and from its
 * previous value on a change) — for the one figure a screen is about. While the count runs the
 * glyphs render plain, because per-glyph entrances would churn against a value that is itself
 * moving; the count is the animation.
 *
 * The per-glyph rise needs a row's height to itself. In a dense table it collides with the rows
 * above and below — `py-1.5` is less than the rise — so lists pass `animated={false}` and get
 * the amount as plain, immediate text.
 */
export interface MoneyProps {
  readonly value: Paise;
  /** Drops the paise on round amounts. For a list, not for a receipt. */
  readonly compact?: boolean | undefined;
  readonly size?: 'body' | 'title' | 'display' | 'mega' | undefined;
  /** Status colouring, for a credit or an overdue balance. `gold` is for the hero figure. */
  readonly tone?: 'default' | 'positive' | 'critical' | 'gold' | undefined;
  /** A soft halo behind the digits. Pairs with `gold`, and earns its keep in dark mode. */
  readonly glow?: boolean | undefined;
  /** Counts up to the value on load. One hero figure per screen; never a list. */
  readonly countUp?: boolean | undefined;
  /**
   * The per-glyph rise on load. Default on, for a figure standing in space; off for a table
   * cell, where the motion crashes into the neighbouring rows.
   */
  readonly animated?: boolean | undefined;
  readonly pending?: boolean | undefined;
  /** Names the amount for a reader who arrives at it out of context. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

const SIZE: Readonly<Record<'body' | 'title' | 'display' | 'mega', string>> = {
  body: 'type-body',
  title: 'type-title',
  display: 'type-display',
  mega: 'type-mega',
};

const TONE: Readonly<Record<'default' | 'positive' | 'critical' | 'gold', string>> = {
  default: 'text-content',
  positive: 'text-positive',
  critical: 'text-critical',
  gold: 'text-gold',
};

export function Money({
  value,
  compact = false,
  size = 'body',
  tone = 'default',
  glow = false,
  countUp = false,
  animated = true,
  pending = false,
  label,
  className,
}: MoneyProps): ReactNode {
  const motionTokens = useMotion();
  const [shown, setShown] = useState<number>(() => (countUp ? 0 : value));
  const from = useRef<number>(countUp ? 0 : value);

  useEffect(() => {
    if (!countUp || motionTokens.reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    // The count runs in whole paise and re-enters the branded type through `paise()` — the
    // one constructor — on every frame. It is animation plumbing, not money arithmetic.
    const controls = animate(from.current, value, {
      duration: seconds(duration.count),
      ease: EASE_OUT,
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, countUp, motionTokens]);

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

  const announce = formatMoney(value, compact ? { compact: true } : undefined);
  const text =
    countUp && shown !== value
      ? formatMoney(paise(shown), compact ? { compact: true } : undefined)
      : announce;
  const rise = motionTokens.travel('near');

  return (
    <span
      className={cn(
        'type-numeric inline-flex items-baseline whitespace-nowrap tabular-nums',
        SIZE[size],
        TONE[tone],
        glow && 'money-glow',
        className,
      )}
      {...(label !== undefined ? { 'aria-label': `${label}: ${announce}` } : {})}
    >
      {animated ? (
        <>
          {/* The amount is announced once, as one string. A per-glyph span would otherwise be read
              out digit by digit, so every glyph below is hidden from readers. */}
          <span className="sr-only">{announce}</span>
          {/* eslint-disable react/no-array-index-key -- an amount's glyphs are fixed positions
              that never reorder; the position is the identity. */}
          {countUp
            ? text.split('').map((glyph, index) => (
                <span key={`${index}:${glyph}`} aria-hidden className="inline-block">
                  {glyph === ' ' ? ' ' : glyph}
                </span>
              ))
            : text.split('').map((glyph, index) => (
                <motion.span
                  key={`${index}:${glyph}`}
                  aria-hidden
                  initial={{ y: rise, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={motionTokens.tween('slow')}
                  className="inline-block"
                >
                  {glyph === ' ' ? ' ' : glyph}
                </motion.span>
              ))}
          {/* eslint-enable react/no-array-index-key */}
        </>
      ) : (
        text
      )}
    </span>
  );
}
