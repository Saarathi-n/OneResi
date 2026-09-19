'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { APPROVAL_STATUS } from '@grihaone/contracts';
import { Badge, Button, Card, RelativeTime, StatusPill } from '@grihaone/ui';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { useAsync } from '@/hooks/useAsync';
import { usePolling } from '@/hooks/usePolling';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { simple } from '@/lib/api';
import type { SocietyWaitingVisitorWire } from '@/lib/types';

/**
 * The gate's queue: who a household has yet to answer, and — once answered — the visit the gate
 * records against its approval. The route map's SSE wrapper cannot carry a Bearer header from an
 * EventSource, so the feed polls `/api/visitors/waiting`, answered society-wide for the gate's
 * account, each row naming the flat its visitor waits on.
 */

const POLL_INTERVAL_MS = 10_000;

export function WaitingFeed(): ReactNode {
  const reduced = useReducedMotion();
  const waiting = useAsync(
    () => simple<readonly SocietyWaitingVisitorWire[]>('/api/visitors/waiting'),
    [],
  );
  const [pendingLogId, setPendingLogId] = useState<number | null>(null);
  const [failed, setFailed] = useState<{ readonly logId: number; readonly message: string } | null>(
    null,
  );

  usePolling(
    useCallback(() => {
      waiting.reload();
    }, [waiting]),
    POLL_INTERVAL_MS,
  );

  async function recordEntry(logId: number, action: 'CHECK_IN' | 'CHECK_OUT'): Promise<void> {
    if (pendingLogId !== null) return;
    setPendingLogId(logId);
    setFailed(null);
    const result = await simple<null>('/api/gate/entry', {
      method: 'POST',
      json: { walkInLogId: logId, action },
    });
    setPendingLogId(null);
    if (!result.ok) {
      setFailed({ logId, message: result.error.message });
      return;
    }
    waiting.reload();
  }

  function actionFor(row: SocietyWaitingVisitorWire): ReactNode {
    if (row.approvalStatus === 'PENDING') {
      return <StatusPill descriptor={APPROVAL_STATUS.PENDING} size="sm" />;
    }
    if (row.approvalStatus === 'REJECTED') {
      return <Badge tone="critical" size="sm">turned away</Badge>;
    }
    if (row.exitedAt !== null) {
      return <Badge tone="neutral" size="sm">in and out</Badge>;
    }
    if (row.enteredAt === null) {
      return (
        <Button
          size="sm"
          pending={pendingLogId === row.logId}
          disabled={pendingLogId !== null && pendingLogId !== row.logId}
          onClick={() => {
            void recordEntry(row.logId, 'CHECK_IN');
          }}
        >
          Check in
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="secondary"
        pending={pendingLogId === row.logId}
        disabled={pendingLogId !== null && pendingLogId !== row.logId}
        onClick={() => {
          void recordEntry(row.logId, 'CHECK_OUT');
        }}
      >
        Check out
      </Button>
    );
  }

  return (
    <section className="mt-8" aria-label="Walk-ins waiting on residents">
      <h2 className="type-label uppercase tracking-wide text-content-subtle">Waiting on residents</h2>
      <div className="mt-3">
        <AsyncView
          state={waiting.state}
          reloading={waiting.reloading}
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="type-body font-medium">{row.name}</p>
                        <p className="mt-1 type-label text-content-subtle">
                          {row.homeLabel !== undefined ? `${row.homeLabel} · ` : ''}
                          {row.purpose}
                        </p>
                        <p className="mt-1 type-label text-content-subtle">
                          waiting <RelativeTime value={row.since} size="label" />
                        </p>
                      </div>
                      <div className="shrink-0">{actionFor(row)}</div>
                    </div>
                    {failed?.logId === row.logId ? (
                      <p
                        role="alert"
                        className="mt-2 rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical"
                      >
                        {failed.message}
                      </p>
                    ) : null}
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
