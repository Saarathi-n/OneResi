'use client';

import type { ReactNode } from 'react';
import { Skeleton } from '@oneresi/ui';
import { useRequireRole } from '@/lib/session';

/**
 * The gate kiosk. Everything under /gate is behind the S role — a resident or a committee member
 * who lands here is sent to their own surface, and a signed-out person to sign-in. The guard holds
 * a skeleton while the session resolves so a shared kiosk device never flashes the wrong shell.
 */
export default function GateLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const guarded = useRequireRole('S');

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
