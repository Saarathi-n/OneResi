'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  Logo,
  Skeleton,
  useToast,
  buttonClass,
} from '@oneresi/ui';
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
  { href: '/gate', label: 'Gate Terminal' },
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
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-20 border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/home" aria-label="OneResi home">
            <Logo variant="wordmark" size={24} />
          </Link>
          <nav aria-label="Resident" className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={buttonClass(pathname === item.href ? 'secondary' : 'ghost', 'sm')}
                aria-current={pathname === item.href ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/home/notifications"
              className={buttonClass('ghost', 'sm', 'rounded-full')}
              aria-label={
                unread === null
                  ? 'Notifications'
                  : unread > 0
                    ? `Notifications, ${unread} unread`
                    : 'Notifications'
              }
            >
              {unread !== null && unread > 0 ? (
                <Badge tone="critical" emphasis="solid" size="sm">
                  {unread}
                </Badge>
              ) : null}
              <span className="hidden sm:inline">Notifications</span>
            </Link>
            <span className="hidden text-right sm:block">
              <span className="type-label block text-content">{person.name}</span>
              {home !== null ? (
                <span className="type-micro block text-content-subtle">
                  {home.blockName} · {home.label}
                </span>
              ) : null}
            </span>
            {person.role === 'A' ? (
              <Link href="/desk" className={buttonClass('secondary', 'sm')}>
                Committee desk
              </Link>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
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
