'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@oneresi/ui';
import { Icon, type IconName } from '@/components/icons';
import { Shell } from '@/components/Shell';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { usePerson } from '@/lib/session';
import { screenClass } from '@/lib/motion';
import { WaitingFeed } from './components/WaitingFeed';
import { openCheckIns } from './lib/checkin-store';

/**
 * The gate home: three jobs, nothing else. Every target is a full-width card the size of a palm,
 * because this screen is used standing up, one-handed, between vehicles. The count on "Inside
 * now" is this kiosk's own open list for today — the guard's mental model of who they let in —
 * and the waiting feed below shows walk-ins residents have not answered yet.
 */

function ActionCard({
  icon,
  title,
  detail,
  onActivate,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
  readonly onActivate: () => void;
}): ReactNode {
  return (
    <Card padding="roomy" onActivate={onActivate}>
      <span className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface-sunken text-accent">
          <Icon name={icon} size={28} />
        </span>
        <span className="min-w-0">
          <span className="block type-title">{title}</span>
          <span className="mt-1 block type-label text-content-subtle">{detail}</span>
        </span>
      </span>
    </Card>
  );
}

export default function GateHomePage(): ReactNode {
  const reduced = useReducedMotion();
  const router = useRouter();
  const person = usePerson();
  const [insideCount, setInsideCount] = useState<number | null>(null);

  useEffect(() => {
    setInsideCount(openCheckIns().length);
  }, []);

  return (
    <Shell
      title="Gate"
      subtitle={person?.name ?? undefined}
      headerRight={
        <Link
          href="/profile"
          aria-label="Your profile"
          className="tab-target -mr-2 flex items-center justify-center rounded-lg text-content-muted focus-ring-inset"
        >
          <Icon name="user" />
        </Link>
      }
    >
      <div className={screenClass('forward', reduced)}>
        <nav aria-label="Gate actions" className="flex flex-col gap-3">
          <ActionCard
            icon="key"
            title="Check a pass code"
            detail="Six digits from the visitor's phone"
            onActivate={() => {
              router.push('/gate/verify');
            }}
          />
          <ActionCard
            icon="plus"
            title="Log a walk-in"
            detail="No code — ask the household, or let them in yourself"
            onActivate={() => {
              router.push('/gate/walk-in');
            }}
          />
          <ActionCard
            icon="users"
            title="Inside now"
            detail={
              insideCount === null
                ? 'Checked in from this gate today'
                : insideCount === 0
                  ? 'Nobody from this gate yet today'
                  : `${insideCount} still inside from this gate`
            }
            onActivate={() => {
              router.push('/gate/entry');
            }}
          />
        </nav>
        <WaitingFeed />
      </div>
    </Shell>
  );
}
