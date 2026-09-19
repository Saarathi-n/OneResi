'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Button,
  Logo,
  Skeleton,
  useToast,
  buttonClass,
} from '@grihaone/ui';
import { onSessionChange, signOut, useGuardedSession, call } from '@/lib/session';
import { useEffect, useState } from 'react';

/**
 * The resident shell: what a signed-in person lives in. The committee desk is a separate, denser
 * shell at /desk (04-product-design.md "Two shells"). This one is a phone-first column with a
 * desktop top bar, and the notifications pill in the header is the only global badge.
 */

const NAV = [
  { href: '/home', label: 'Home' },
  { href: '/home/invoices', label: 'Payments' },
  { href: '/home/visitors', label: 'Visitors' },
  { href: '/home/complaints', label: 'Complaints' },
  { href: '/home/facilities', label: 'Facilities' },
  { href: '/home/notices', label: 'Notices' },
] as const;

const MOBILE_NAV = NAV;


export default function ResidentLayout({ children }: { children: ReactNode }) {
  const guarded = useGuardedSession();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    if (guarded.state !== 'signed-in') return;
    void (async () => {
      const result = await call<{ count: number; items: unknown[] }>('/api/notifications');
      if (result.ok) setUnread(result.data.count);
    })();
  }, [guarded.state, pathname]);

  useEffect(
    () =>
      onSessionChange((who) => {
        if (who === null) setUnread(null);
      }),
    [],
  );

  if (guarded.state !== 'signed-in') {
    return <ShellSkeleton />;
  }

  const person = guarded.person;
  const home = person.home;

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.replace('/sign-in');
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface overflow-x-hidden">
      <header className="sticky top-0 z-20 border-b border-border bg-surface-raised/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-4 lg:gap-6 min-w-0">
            <Link href="/home" aria-label="GrihaOne home" className="shrink-0 flex items-center">
              <Logo variant="wordmark" size={24} />
            </Link>
            <nav aria-label="Resident" className="hidden items-center gap-1 md:flex overflow-x-auto py-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={buttonClass(pathname === item.href ? 'secondary' : 'ghost', 'sm', 'whitespace-nowrap shrink-0')}
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link
              href="/home/notifications"
              className="relative flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full border border-border bg-surface hover:bg-surface-sunken text-content transition-colors shrink-0"
              aria-label={
                unread === null
                  ? 'Notifications'
                  : unread > 0
                    ? `Notifications, ${unread} unread`
                    : 'Notifications'
              }
            >
              <svg className="size-4 text-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unread !== null && unread > 0 ? (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-critical text-[10px] font-bold text-critical-on">
                  {unread}
                </span>
              ) : null}
            </Link>

            {person.role === 'A' ? (
              <Link href="/desk" className={buttonClass('secondary', 'sm', 'hidden lg:inline-flex whitespace-nowrap')}>
                Committee desk
              </Link>
            ) : null}

            {/* Resident Profile Pill */}
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface pl-2.5 pr-1.5 py-1 text-left shadow-xs">
              <div className="hidden sm:block leading-tight text-right pr-1">
                <span className="type-label block text-xs font-semibold text-content whitespace-nowrap">
                  {person.name.split(' ')[0]}
                </span>
                {home !== null ? (
                  <span className="type-micro block text-[10px] text-content-subtle whitespace-nowrap">
                    {home.label}
                  </span>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs rounded-full"
                onClick={() => {
                  void handleSignOut().then(() => {
                    toast.show({ title: 'Signed out', description: 'See you soon.' });
                  });
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
        {/* The phone navigation: a scrollable strip under the wordmark. */}
        <nav
          aria-label="Resident"
          className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden"
        >
            {MOBILE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={buttonClass(pathname === item.href ? 'secondary' : 'ghost', 'sm', 'shrink-0')}
              >
                {item.label}
              </Link>
            ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-10">
        {children}
      </main>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo variant="wordmark" size={24} />
          <Skeleton variant="circle" width={32} height={32} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton variant="text" width="60%" height={28} />
        <Skeleton variant="block" height={120} />
        <Skeleton variant="block" height={200} />
      </main>
    </div>
  );
}
