'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@oneresi/ui';
import { Icon, type IconName } from './icons';

/**
 * The bottom tab bar. Phone-shaped: five tabs at most, 44px targets, the safe-area inset below,
 * and the current tab carries the label plus the icon — an icon alone has to be decoded, and a
 * person glancing at a phone in a lift should not have to.
 */

export interface TabDef {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly badge?: number | undefined;
}

export function BottomTabs({ tabs, active }: { readonly tabs: readonly TabDef[]; readonly active: string }): ReactNode {
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-20 border-t border-border bg-surface-raised/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1">
        {tabs.map((tab) => {
          const isActive = tab.href === active;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'tab-target mx-auto flex flex-col items-center gap-0.5 rounded-lg px-2 pt-2 pb-1 type-label focus-ring-inset',
                  isActive ? 'text-accent' : 'text-content-subtle',
                )}
              >
                <span className="relative">
                  <Icon name={tab.icon} size={22} />
                  {tab.badge !== undefined && tab.badge > 0 ? (
                    <span
                      className="absolute -top-1.5 -right-2 flex min-w-4 h-4 items-center justify-center rounded-pill bg-critical px-1 type-micro text-critical-on"
                      aria-hidden
                    >
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
