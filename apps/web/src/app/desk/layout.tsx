'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Logo, Skeleton, useToast } from '@oneresi/ui';
import { signOut, useGuardedSession } from '@/lib/session';

/**
 * The committee desk: the second shell (04-product-design.md). Dense, desktop-first, keyboard
 * first — a committee member works through queues, not pages. The command palette (Ctrl-K or the
 * button) jumps anywhere in the desk and the resident screens.
 */

const NAV = [
  { href: '/desk', label: 'Queue', key: 'q' },
  { href: '/desk/ledger', label: 'Ledger', key: 'l' },
  { href: '/desk/complaints', label: 'Complaints', key: 'c' },
  { href: '/desk/bookings', label: 'Bookings', key: 'b' },
  { href: '/desk/announcements', label: 'Announcements', key: 'a' },
  { href: '/desk/property', label: 'Property', key: 'p' },
] as const;

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
      <header className="sticky top-0 z-20 border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
          <Link href="/desk" aria-label="Committee desk home">
            <Logo variant="wordmark" size={22} />
          </Link>
          <span className="type-label ml-2 hidden text-content-subtle sm:inline">
            Committee desk
          </span>
          <nav aria-label="Committee" className="ml-4 flex items-center gap-1">
            {NAV.map((item) => (
              <Button
                key={item.href}
                variant={pathname === item.href ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => router.push(item.href)}
                aria-current={pathname === item.href ? 'page' : undefined}
              >
                {item.label}
              </Button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              leadingIcon={<Badge tone="neutral" size="sm">Ctrl-K</Badge>}
            >
              Jump to
            </Button>
            <Link href="/home">
              <Button variant="ghost" size="sm">
                Resident view
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
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
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2">
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
      ...NAV.map((item) => ({ href: item.href, label: item.label, hint: 'Desk' })),
      { href: '/home', label: 'Resident home', hint: 'Resident' },
      { href: '/home/invoices', label: 'Payments', hint: 'Resident' },
      { href: '/home/visitors', label: 'Visitors', hint: 'Resident' },
      { href: '/home/complaints', label: 'Complaints', hint: 'Resident' },
      { href: '/home/facilities', label: 'Facilities', hint: 'Resident' },
      { href: '/home/notices', label: 'Notices', hint: 'Resident' },
      { href: '/gate', label: 'Gate kiosk', hint: 'Gate' },
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
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface-raised shadow-e4"
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
          className="type-body w-full border-b border-border bg-surface px-4 py-3 text-content outline-none"
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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2">
          <Logo variant="wordmark" size={22} />
          <Skeleton variant="text" width={120} height={20} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
        <Skeleton variant="text" width="40%" height={28} />
        <Skeleton variant="block" height={240} />
      </main>
    </div>
  );
}
