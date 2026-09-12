'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Tone } from '@grihaone/contracts';
import { cn } from '../internal/cn.js';
import { toneTextClass } from '../internal/tone.js';
import { useMotion } from '../motion/useMotion.js';

/**
 * A ring for a completion count — the first-login checklist, a household profile, a billing run
 * working through units. It animates to the new value rather than jumping, because a jump reads
 * as a re-render and not as progress.
 */
export interface ProgressRingProps {
  readonly value: number;
  readonly max?: number | undefined;
  /** Outer diameter in pixels. */
  readonly size?: number | undefined;
  readonly thickness?: number | undefined;
  /** Required: what is being counted. Announced with the value. */
  readonly label: string;
  readonly tone?: Tone | undefined;
  /** Working, with no count yet. The ring turns instead of filling. */
  readonly pending?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Shown in the middle. A count, a percentage, an icon — the caller decides. */
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}
export function ProgressRing({
  value,
  max = 100,
  size = 56,
  thickness = 6,
  label,
  tone,
  pending = false,
  disabled = false,
  children,
  className,
}: ProgressRingProps): ReactNode {
  const motionTokens = useMotion();

  const safeMax = max <= 0 ? 1 : max;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = pending ? circumference * 0.25 : circumference * (clamped / safeMax);

  return (
    <div
      className={cn(
        'relative inline-flex items-center justify-center',
        disabled ? 'opacity-55' : undefined,
        className,
      )}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      {...(pending
        ? { 'aria-busy': true }
        : {
            'aria-valuenow': clamped,
            'aria-valuetext': `${clamped} of ${safeMax}`,
          })}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn('-rotate-90', pending ? 'spinner' : undefined)}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          className="text-surface-sunken"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          className={tone === undefined ? 'text-accent' : toneTextClass[tone]}
          initial={false}
          animate={{ strokeDashoffset: circumference - filled }}
          transition={motionTokens.spring('medium')}
        />
      </svg>

      {children !== undefined ? (
        <span className="absolute inset-0 flex items-center justify-center type-label text-content">
          {children}
        </span>
      ) : null}
    </div>
  );
}
