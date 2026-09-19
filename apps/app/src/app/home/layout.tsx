'use client';

import type { ReactNode } from 'react';
import { Skeleton } from '@grihaone/ui';
import { useRequireRole } from '@/lib/session';

/**
 * The resident shell. Everything under /home is behind the R role — a committee member or a guard
 * who lands here is sent to their own surface, and a signed-out person to sign-in. The guard holds
 * a skeleton while the session resolves so nobody ever sees a flash of the wrong shell.
 */
export default function HomeLayout({ children }: { readonly children: ReactNode }): ReactNode {
  const guarded = useRequireRole('R');

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
