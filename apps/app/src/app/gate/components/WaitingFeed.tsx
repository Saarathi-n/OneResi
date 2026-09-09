'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Card, RelativeTime } from '@oneresi/ui';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { useAsync } from '@/hooks/useAsync';
import { usePolling } from '@/hooks/usePolling';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { simple } from '@/lib/api';
import type { WaitingVisitorWire } from '@/lib/types';

/**
 * The waiting feed. The route map's live route (GET /api/gate/live) is an SSE stream, but the
 * web app authenticates every request with an Authorization: Bearer header and an EventSource
 * cannot carry one — credentials:'include' only forwards cookies, and the API reads no cookie at
 * that route. So this feed polls `/api/visitors/waiting` instead: the same read the resident
 * visitors screen uses, answered society-wide for the gate's account, each row naming the flat
 * its visitor waits on.
 */

const POLL_INTERVAL_MS = 10_000;

export function WaitingFeed(): ReactNode {
  const reduced = useReducedMotion();
  const waiting = useAsync(() => simple<readonly WaitingVisitorWire[]>('/api/visitors/waiting'), []);

  usePolling(
    useCallback(() => {
      waiting.reload();
    }, [waiting]),
    POLL_INTERVAL_MS,
  );

  return (
    <section className="mt-8" aria-label="Walk-ins waiting on residents">
      <h2 className="type-label uppercase tracking-wide text-content-subtle">Waiting on residents</h2>
      <div className="mt-3">
        <AsyncView
          state={waiting.state}
          skeleton={<CardListSkeleton rows={2} />}
          empty={
            <Card padding="tight">
              <p className="type-body text-content-subtle">No walk-ins waiting right now.</p>
            </Card>
          }
          render={(rows) => (
            <div className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <div key={row.logId} style={rowStyle(index, reduced)} className="row-in">
                  <Card padding="tight">
                    <p className="type-body font-medium">{row.name}</p>
                    <p className="mt-1 type-label text-content-subtle">
                      {row.homeLabel !== undefined ? `${row.homeLabel} · ` : ''}
                      {row.purpose}
                    </p>
                    <p className="mt-1 type-label text-content-subtle">
                      waiting <RelativeTime value={row.since} size="label" />
                    </p>
                  </Card>
                </div>
              ))}
            </div>
          )}
          onRetry={() => {
            waiting.reload();
          }}
        />
      </div>
    </section>
  );
}
