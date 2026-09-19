'use client';

import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@grihaone/ui';
import { Icon } from './icons';
import { BottomTabs, type TabDef } from './BottomTabs';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useReplayQueue } from '../hooks/useReplayQueue';
import { flush } from '../lib/replay-queue';
import { springSettleMs } from '../lib/motion';

/**
 * The phone shell every screen sits in: a header with the screen's name (and a back affordance
 * when there is somewhere to go back to), a scroll column with pull-to-refresh, the offline
 * banner with the pending write count, and the pinned bottom tab bar. Safe-area insets on both
 * edges; the primary action is always within a thumb's reach.
 */

export interface ShellProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly backHref?: string | undefined;
  readonly tabs?: readonly TabDef[] | undefined;
  readonly activeTab?: string | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly children: ReactNode;
  readonly headerRight?: ReactNode | undefined;
}

const PULL_RESISTANCE = 0.45;
const PULL_TRIGGER = 72;

export function Shell({
  title,
  subtitle,
  backHref,
  tabs,
  activeTab,
  onRefresh,
  children,
  headerRight,
}: ShellProps): ReactNode {
  const reduced = useReducedMotion();
  const queue = useReplayQueue();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  const settleMs = reduced ? 140 : springSettleMs();

  const onTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    startY.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (startY.current === null || onRefresh === undefined) return;
      const target = event.currentTarget;
      if (target.scrollTop > 0) {
        startY.current = null;
        return;
      }
      const delta = (event.touches[0]?.clientY ?? 0) - startY.current;
      if (delta > 0) setPull(Math.min(96, delta * PULL_RESISTANCE));
    },
    [onRefresh],
  );

  const release = useCallback(async () => {
    if (pull >= PULL_TRIGGER && onRefresh !== undefined && !refreshing) {
      setRefreshing(true);
      setPull(28);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
    startY.current = null;
  }, [pull, onRefresh, refreshing]);

  const trigger = Math.min(1, pull / PULL_TRIGGER);

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header
        className="sticky top-0 z-10 border-b border-border bg-surface-raised/95 backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4 py-3">
          {backHref !== undefined ? (
            <Link
              href={backHref}
              aria-label="Back"
              className="tab-target -ml-2 flex items-center justify-center rounded-lg text-content-muted focus-ring-inset"
            >
              <Icon name="chevron-left" />
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate type-title">{title}</h1>
            {subtitle !== undefined ? (
              <p className="truncate type-label text-content-subtle">{subtitle}</p>
            ) : null}
          </div>
          {headerRight}
        </div>
      </header>

      {queue.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            void flush();
          }}
          className="flex items-center justify-center gap-2 border-b border-caution-border bg-caution-soft px-4 py-2 type-label text-caution focus-ring-inset"
        >
          <Icon name="offline" size={16} />
          {queue.length === 1
            ? 'One change saved on this phone — tap to send'
            : `${queue.length} changes saved on this phone — tap to send`}
        </button>
      ) : null}

      <div
        className="app-scroll relative flex-1 overflow-y-auto"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => {
          void release();
        }}
        onTouchCancel={() => {
          void release();
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
          style={{ transform: `translateY(${pull - 36}px)`, opacity: trigger }}
          aria-hidden
        >
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full border border-border bg-surface-raised shadow-e2',
              refreshing ? 'spinner' : undefined,
            )}
            style={refreshing ? undefined : { transform: `rotate(${pull * 4}deg)` }}
          >
            <Icon name="refresh" size={16} />
          </span>
        </div>

        <main
          className={cn('mx-auto w-full max-w-lg px-4 pt-4 pb-8', pull === 0 ? undefined : 'pull-settle')}
          style={
            pull === 0
              ? { transitionDuration: `${settleMs}ms`, transform: 'translateY(0px)' }
              : { transform: `translateY(${pull}px)` }
          }
        >
          {children}
        </main>
      </div>

      {tabs !== undefined && activeTab !== undefined ? <BottomTabs tabs={tabs} active={activeTab} /> : null}
    </div>
  );
}
