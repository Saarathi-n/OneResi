'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../internal/cn.js';
import { Skeleton } from './Skeleton.js';

/**
 * A timestamp as a person would say it, with the exact time one hover away.
 *
 * The first render is the absolute date — on the server there is no "now" to compare against,
 * and rendering a relative string there and a different one on hydration is how a timestamp
 * ends up flickering. After mount it becomes relative and keeps itself current.
 */
export interface RelativeTimeProps {
  readonly value: Date | string | number;
  /** Past this many days the absolute date is clearer than "5 weeks ago". */
  readonly absoluteAfterDays?: number | undefined;
  readonly size?: 'micro' | 'label' | 'body' | undefined;
  readonly pending?: boolean | undefined;
  readonly className?: string | undefined;
}

const SIZE: Readonly<Record<'micro' | 'label' | 'body', string>> = {
  micro: 'type-micro',
  label: 'type-label',
  body: 'type-body',
};

const RELATIVE = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

const ABSOLUTE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const ABSOLUTE_WITH_TIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function describe(target: number, now: number): string {
  const delta = target - now;
  const magnitude = Math.abs(delta);

  if (magnitude < MINUTE) return 'just now';
  if (magnitude < HOUR) return RELATIVE.format(Math.round(delta / MINUTE), 'minute');
  if (magnitude < DAY) return RELATIVE.format(Math.round(delta / HOUR), 'hour');
  if (magnitude < 7 * DAY) return RELATIVE.format(Math.round(delta / DAY), 'day');
  return RELATIVE.format(Math.round(delta / (7 * DAY)), 'week');
}

/** Frequent while the difference is small, then rarely. No timer at all once it is a date. */
function cadence(magnitude: number): number | null {
  if (magnitude < HOUR) return 30_000;
  if (magnitude < DAY) return 5 * MINUTE;
  return null;
}

export function RelativeTime({
  value,
  absoluteAfterDays = 30,
  size = 'micro',
  pending = false,
  className,
}: RelativeTimeProps): ReactNode {
  const target = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, [target]);

  useEffect(() => {
    if (now === null) return undefined;
    const every = cadence(Math.abs(target - now));
    if (every === null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => {
      window.clearInterval(timer);
    };
  }, [now, target]);
  if (pending) {
    return (
      <span className={cn(SIZE[size], className)} aria-busy>
        <Skeleton variant="text" width="7ch" />
      </span>
    );
  }

  if (Number.isNaN(target)) return null;

  const date = new Date(target);
  const exact = ABSOLUTE_WITH_TIME.format(date);
  const tooOld = now !== null && Math.abs(target - now) > absoluteAfterDays * DAY;
  const shown = now === null || tooOld ? ABSOLUTE.format(date) : describe(target, now);

  return (
    <time
      dateTime={date.toISOString()}
      title={exact}
      className={cn('text-content-subtle', SIZE[size], className)}
    >
      {shown}
    </time>
  );
}

