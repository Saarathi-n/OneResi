'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Logo, Skeleton } from '@oneresi/ui';
import { roleHome, useSession } from '@/lib/session';

/**
 * The entry screen. One job: resolve the session and go where the role goes — a resident lands
 * on their home, the committee on the desk, the gate on the kiosk. While the cookie round trip
 * is in flight this holds a skeleton rather than flashing a redirect.
 */
export default function EntryPage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status.state === 'signed-out') {
      router.replace('/sign-in');
    } else if (status.state === 'signed-in') {
      router.replace(roleHome(status.person.role));
    }
  }, [status, router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <Logo size={44} />
      <div className="flex flex-col items-center gap-3" aria-busy>
        <Skeleton variant="text" width={140} />
        <Skeleton variant="text" width={220} height={12} />
      </div>
    </main>
  );
}
