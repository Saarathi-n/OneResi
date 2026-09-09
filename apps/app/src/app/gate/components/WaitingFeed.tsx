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
 * that route. The stream is documented as a wrapper over visitors.waitingForHousehold, so this
 * feed polls that same endpoint, exactly as the resident visitors screen does.
 *
 * That service answers per household. The gate account holds no unit, so the API answers
 * FORBIDDEN — the society-wide pending list the kiosk would want does not exist yet. Rather than
 * hammering a route that will never answer for this role, the feed shows one quiet explanation
 * and stops polling (see the foundation gap noted in the gate report).
 */

const POLL_INTERVAL_MS = 10_000;

export function WaitingFeed(): ReactNode {
  const reduced = useReducedMotion();
  const waiting = useAsync(() => simple<readonly WaitingVisitorWire[]>('/api/visitors/waiting'), []);

  const forbidden = waiting.state.state === 'failed' && waiting.state.error.code === 'FORBIDDEN';

  usePolling(
    useCallback(() => {
      waiting.reload();
    }, [waiting]),
    POLL_INTERVAL_MS,
    { enabled: !forbidden },
  );

  return (
    <section className="mt-8" aria-label="Walk-ins waiting on residents">
      <h2 className="type-label uppercase tracking-wide text-content-subtle">Waiting on residents</h2>
      <div className="mt-3">
        {forbidden ? (
          <Card padding="tight">
            <p className="type-body font-medium">Residents answer from their own phones</p>
            <p className="mt-1 type-label text-content-subtle">
              Every walk-in logged at this gate reaches the household instantly — their approval
              lands on the resident&apos;s phone, so there is nothing to watch here.
            </p>
          </Card>
        ) : (
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
                      <p className="mt-1 type-label text-content-subtle">{row.purpose}</p>
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
        )}
      </div>
    </section>
  );
}
