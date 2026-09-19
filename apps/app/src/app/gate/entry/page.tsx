'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  buttonClass,
} from '@grihaone/ui';
import { CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { call } from '@/lib/api';
import { rowStyle, screenClass } from '@/lib/motion';
import { openCheckIns, removeOpenCheckIn, type OpenCheckIn } from '../lib/checkin-store';
import { formatTimeOfDay } from '../lib/time';

/**
 * Who is inside because this kiosk checked them in. The API offers no society-wide "inside now"
 * read for the gate role, so the list is the kiosk's own day-scoped record (see lib/checkin-store)
 * — which is also the list that matters to the guard at this gate. Checking out posts
 * RecordEntryInput with CHECK_OUT; the entry is already open on the server, so no idempotency key
 * is needed — a repeated tap or retry cannot double-close what the server closes once.
 */

export default function EntryPage(): ReactNode {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<readonly OpenCheckIn[] | null>(null);
  const [busyPassId, setBusyPassId] = useState<number | null>(null);
  const [failures, setFailures] = useState<Readonly<Record<number, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // localStorage is not available during server rendering; the list arrives after mount so the
  // server and client markup agree.
  useEffect(() => {
    setOpen(openCheckIns());
  }, []);

  const refresh = useCallback(async () => {
    setOpen(openCheckIns());
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
  }, []);

  const checkOut = useCallback(async (entry: OpenCheckIn): Promise<void> => {
    setBusyPassId(entry.passId);
    setNotice(null);
    setFailures((prev) => {
      const next = { ...prev };
      delete next[entry.passId];
      return next;
    });

    const outcome = await call('/api/gate/entry', {
      method: 'POST',
      json: { passId: entry.passId, action: 'CHECK_OUT' },
    });
    setBusyPassId(null);

    if (outcome.ok) {
      removeOpenCheckIn(entry.passId);
      setOpen(openCheckIns());
      setNotice(`${entry.visitorName} checked out at ${formatTimeOfDay(new Date())}`);
      return;
    }

    if ('network' in outcome && outcome.network) {
      setFailures((prev) => ({
        ...prev,
        [entry.passId]: 'You appear to be offline. Try again once the signal returns.',
      }));
      return;
    }

    if (outcome.error.code === 'STATE_NOT_ALLOWED' || outcome.error.code === 'ALREADY_DONE') {
      // The server says this entry is not open — someone closed it from another device or the
      // resident's side. Trust the server and align this kiosk's list.
      removeOpenCheckIn(entry.passId);
      setOpen(openCheckIns());
      setNotice(`${entry.visitorName} was already checked out — removed from this list.`);
      return;
    }

    setFailures((prev) => ({ ...prev, [entry.passId]: outcome.error.message }));
  }, []);

  return (
    <Shell
      title="Inside now"
      subtitle="Checked in from this gate today"
      backHref="/gate"
      onRefresh={refresh}
    >
      <div className={screenClass('forward', reduced)}>
        {notice !== null ? (
          <p
            role="status"
            className="rounded-lg border border-positive-border bg-positive-soft px-3 py-2 type-label text-positive"
          >
            {notice}
          </p>
        ) : null}

        {open === null ? (
          <div className="mt-3" aria-busy>
            <span className="sr-only">Loading today&apos;s check-ins</span>
            <CardListSkeleton rows={2} />
          </div>
        ) : open.length === 0 ? (
          <Card padding="roomy" className="mt-3">
            <p className="type-title">Nobody is inside from this gate</p>
            <p className="mt-2 type-body text-content-subtle">
              Visitors you check in with a pass code will appear here until they leave.
            </p>
            <div className="mt-6">
              <Link href="/gate/verify" className={buttonClass('primary', 'kiosk', 'w-full')}>
                Check a pass code
              </Link>
            </div>
          </Card>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {open.map((entry, index) => (
              <li key={entry.passId} style={rowStyle(index, reduced)} className="row-in">
                <Card padding="roomy">
                  <p className="text-[22px] font-semibold leading-tight">{entry.visitorName}</p>
                  <p className="mt-1 type-body text-content-subtle">{entry.destination}</p>
                  <p className="mt-1 type-label text-content-subtle">
                    {entry.purpose} · in at {formatTimeOfDay(entry.checkedInAt)}
                  </p>
                  {failures[entry.passId] !== undefined ? (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical"
                    >
                      {failures[entry.passId]}
                    </p>
                  ) : null}
                  <div className="mt-5">
                    <Button
                      size="kiosk"
                      fullWidth
                      pending={busyPassId === entry.passId}
                      pendingLabel="Recording the exit"
                      onClick={() => {
                        void checkOut(entry);
                      }}
                    >
                      Check out
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
