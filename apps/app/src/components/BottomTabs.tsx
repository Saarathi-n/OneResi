'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@oneresi/ui';
import { Icon, type IconName } from './icons';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Floating frosted glass pill navigation bar for mobile PWA (Ref 24).
 * Detached above the bottom safe area, rounded-pill shape with bg-surface-glass
 * and backdrop-blur, animated sliding indicator on the active tab, and 44px+ touch targets.
 */

export interface TabDef {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly badge?: number | undefined;
}

export function BottomTabs({
  tabs,
  active,
}: {
  readonly tabs: readonly TabDef[];
  readonly active: string;
}): ReactNode {
  const reduced = useReducedMotion();
  const activeIndex = tabs.findIndex(
    (tab) => tab.href === active || (tab.href !== '/home' && active.startsWith(tab.href)),
  );
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  const tabCount = tabs.length;
  const tabWidthPercent = tabCount > 0 ? 100 / tabCount : 20;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <nav
        aria-label="Main"
        className="pointer-events-auto relative mx-auto w-full max-w-lg rounded-full border border-border/80 bg-surface-glass backdrop-blur-xl shadow-e3 px-1.5 py-1"
      >
        {/* Animated sliding indicator on active tab */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-1.5 transition-transform ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            width: `calc(${tabWidthPercent}% - 3px)`,
            transform: `translateX(${safeIndex * 100}%)`,
            transitionDuration: reduced ? '0ms' : '260ms',
          }}
        >
          {/* Top indicator bar matching reference 24 */}
          <div className="mx-auto h-0.5 w-6 rounded-full bg-accent" />
          {/* Subtle frosted capsule background */}
          <div className="mt-0.5 h-[calc(100%-4px)] w-full rounded-full bg-accent-soft/40" />
        </div>

        <ul className="relative flex items-center justify-around">
          {tabs.map((tab) => {
            const isActive = tab.href === active || (tab.href !== '/home' && active.startsWith(tab.href));
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-[46px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-full px-2 py-1 transition-colors focus-ring-inset',
                    isActive
                      ? 'text-accent font-semibold'
                      : 'text-content-subtle hover:text-content font-medium',
                  )}
                >
                  <span className="relative flex items-center justify-center">
                    <Icon name={tab.icon} size={20} />
                    {tab.badge !== undefined && tab.badge > 0 ? (
                      <span
                        className="absolute -top-1 -right-2.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-bold text-critical-on"
                        aria-hidden
                      >
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="type-micro leading-none tracking-tight">{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
