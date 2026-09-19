'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Logo,
  Skeleton,
  useToast,
  buttonClass,
} from '@grihaone/ui';
import { signOut, useGuardedSession } from '@/lib/session';

/**
 * The committee desk: executive command shell. Dense, desktop-first, keyboard
 * first — a committee member works through operational queues with clear visual hierarchy.
 * The command palette (Ctrl-K or the button) jumps anywhere in the desk and resident screens.
 */

const PRIMARY_NAV = [
  { href: '/desk', label: 'Overview', key: 'q' },
  { href: '/desk/ledger', label: 'Ledger', key: 'l' },
  { href: '/desk/complaints', label: 'Complaints', key: 'c' },
  { href: '/desk/bookings', label: 'Bookings', key: 'b' },
] as const;

const OPERATIONS_NAV = [
  { href: '/desk/announcements', label: 'Announcements', key: 'a' },
  { href: '/desk/property', label: 'Property', key: 'p' },
  { href: '/desk/facilities', label: 'Amenities', key: 'f' },
  { href: '/desk/reports', label: 'Reports', key: 'r' },
  { href: '/desk/applications', label: 'Applications', key: 'n' },
] as const;

const ALL_NAV = [...PRIMARY_NAV, ...OPERATIONS_NAV] as const;

const PALETTE_HINT = 'Ctrl-K jumps anywhere';

export default function DeskLayout({ children }: { children: ReactNode }) {
  const guarded = useGuardedSession('COMMITTEE');
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (guarded.state !== 'signed-in') {
    return <DeskSkeleton />;
  }

  const person = guarded.person;

  async function handleSignOut(): Promise<void> {
    await signOut();
    router.replace('/sign-in');
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-20 border-b border-border bg-surface-raised shadow-xs">
        {/* Tier 1: Executive Top Bar */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/desk" aria-label="Committee desk home" className="flex items-center gap-2.5">
              <Logo variant="wordmark" size={24} />
            </Link>
            <span className="type-micro hidden rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 font-semibold tracking-wider text-content-subtle sm:inline-block">
              Committee Desk
            </span>
          </div>

          {/* Right-aligned utility actions & search shortcut */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              leadingIcon={
                <span className="type-micro whitespace-nowrap rounded-xs border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-content-subtle">
                  Ctrl K
                </span>
              }
            >
              Jump to
            </Button>
            <div className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <Link
              href="/home"
              className={buttonClass('ghost', 'sm', 'text-content-muted hover:text-content hover:bg-surface-sunken')}
            >
              Resident View
            </Link>
            <Link
              href="/gate"
              className={buttonClass('ghost', 'sm', 'text-content-muted hover:text-content hover:bg-surface-sunken')}
            >
              Gate Terminal
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="text-content-muted hover:text-content hover:bg-surface-sunken"
              onClick={() => {
                void handleSignOut().then(() => {
                  toast.show({ title: 'Signed out' });
                });
              }}
            >
              Sign out
            </Button>
          </div>
        </div>

        {/* Tier 2: Dedicated Executive Navigation Bar */}
        <div className="border-t border-border/70 bg-surface-raised/80 backdrop-blur-xs">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 overflow-x-auto px-4 py-2 sm:px-6">
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Primary Tabs */}
              <nav aria-label="Primary queues" className="flex items-center gap-1.5">
                {PRIMARY_NAV.map((item) => {
                  const isActive =
                    item.href === '/desk'
                      ? pathname === '/desk'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={buttonClass(
                        isActive ? 'primary' : 'ghost',
                        'sm',
                        isActive
                          ? 'shadow-xs font-semibold'
                          : 'text-content-muted hover:text-content hover:bg-surface-sunken/70',
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              {/* Hierarchy Divider */}
              <div className="hidden h-5 w-px bg-border md:block" aria-hidden />

              {/* Operations / Society Group */}
              <nav aria-label="Operations and society" className="flex items-center gap-1.5">
                <span className="type-micro hidden font-semibold uppercase tracking-wider text-content-subtle lg:inline px-1">
                  Operations
                </span>
                {OPERATIONS_NAV.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={buttonClass(
                        isActive ? 'primary' : 'ghost',
                        'sm',
                        isActive
                          ? 'shadow-xs font-semibold'
                          : 'text-content-muted hover:text-content hover:bg-surface-sunken/70',
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-border bg-surface-raised/40">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6">
          <p className="type-micro text-content-subtle">
            {person.name} · {PALETTE_HINT}
          </p>
        </div>
      </footer>

      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(href) => {
          setPaletteOpen(false);
          router.push(href);
        }}
      />
    </div>
  );
}

/** Keyboard-first navigation: type, arrows, Enter. No mouse required, none refused. */
function Palette({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const destinations = useMemo(
    () => [
      ...ALL_NAV.map((item) => ({ href: item.href, label: item.label, hint: 'Desk' })),
      { href: '/home', label: 'Resident View', hint: 'Resident' },
      { href: '/home/invoices', label: 'Payments', hint: 'Resident' },
      { href: '/home/visitors', label: 'Visitors', hint: 'Resident' },
      { href: '/home/complaints', label: 'Complaints', hint: 'Resident' },
      { href: '/home/facilities', label: 'Amenities', hint: 'Resident' },
      { href: '/home/notices', label: 'Notices', hint: 'Resident' },
      { href: '/gate', label: 'Gate Terminal', hint: 'Gate' },
    ],
    [],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return destinations;
    return destinations.filter(
      (destination) =>
        destination.label.toLowerCase().includes(needle) ||
        destination.hint.toLowerCase().includes(needle),
    );
  }, [destinations, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay p-4 pt-[15vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface-glass shadow-e4 backdrop-blur-xl edge-light"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Jump to"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, matches.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const destination = matches[active];
              if (destination !== undefined) onNavigate(destination.href);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Where are you going?"
          aria-label="Search destinations"
          className="type-body w-full border-b border-border bg-transparent px-4 py-3 text-content outline-none placeholder:text-content-subtle"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {matches.map((destination, index) => (
            <li key={destination.href}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-4 py-2 text-left ${
                  index === active ? 'bg-accent-soft' : 'bg-transparent'
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => onNavigate(destination.href)}
              >
                <span className="type-body text-content">{destination.label}</span>
                <span className="type-micro text-content-subtle">{destination.hint}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li className="px-4 py-3">
              <span className="type-body text-content-subtle">Nothing matches that.</span>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function DeskSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo variant="wordmark" size={24} />
            <Skeleton variant="text" width={100} height={18} />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton variant="text" width={90} height={32} />
            <Skeleton variant="text" width={90} height={32} />
          </div>
        </div>
        <div className="border-t border-border/70 px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <Skeleton variant="text" width={70} height={32} />
            <Skeleton variant="text" width={70} height={32} />
            <Skeleton variant="text" width={80} height={32} />
            <Skeleton variant="text" width={75} height={32} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton variant="text" width="40%" height={28} />
        <Skeleton variant="block" height={240} />
      </main>
    </div>
  );
}
