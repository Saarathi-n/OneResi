'use client';

import type { ReactNode } from 'react';
import { Skeleton } from '@oneresi/ui';
import { useRequireRole } from '@/lib/session';

/**
 * The committee desk. Everything under /desk is behind the A role — a resident or a guard who
 * lands here is sent to their own surface, and a signed-out person to sign-in. The guard holds a
 * skeleton while the session resolves so nobody sees a flash of the wrong shell.
 */
export default function DeskLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const guarded = useRequireRole('A');

  if (guarded.state !== 'ok') {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3 px-4 pt-6" aria-busy>
        <span className="sr-only">Checking your session</span>
        <Skeleton height={96} className="rounded-xl" />
        <Skeleton height={72} className="rounded-xl" />
        <Skeleton height={72} className="rounded-xl" />
      </div>
    );
  }

  return <>{children}</>;
}
