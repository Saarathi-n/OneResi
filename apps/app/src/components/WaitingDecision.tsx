'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Card } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { simple } from '@/lib/api';
import { rowStyle } from '@/lib/motion';
import type { WaitingVisitorWire } from '@/lib/types';

/**
 * A walk-in the gate is holding for this household's answer. The same card serves the dashboard
 * and the visitors screen: the decision is the point, so it is answerable wherever the person
 * happens to be looking.
 */
export function WaitingDecision({
  visitor,
  index,
  reduced,
  onDecided,
}: {
  readonly visitor: WaitingVisitorWire;
  readonly index: number;
  readonly reduced: boolean;
  readonly onDecided: (name: string, admitted: boolean) => void;
}): ReactNode {
  const [pending, setPending] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function decide(decision: 'APPROVE' | 'REJECT'): Promise<void> {
    if (pending !== null) return;
    setPending(decision);
    setFailed(null);
    const result = await simple<null>(`/api/visitors/walk-ins/${visitor.logId}/decision`, {
      method: 'POST',
      json: { logId: visitor.logId, decision },
    });
    if (result.ok) {
      onDecided(visitor.name, decision === 'APPROVE');
      return;
    }
    setPending(null);
    setFailed(result.error.message);
  }

  return (
    <div className="row-in" style={rowStyle(index, reduced)}>
      <Card tone="caution">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="type-body font-medium">{visitor.name} is at the gate</p>
            <p className="type-label text-content-muted">
              {visitor.purpose}
              {visitor.phone !== null ? ` · ${visitor.phone}` : ''}
            </p>
          </div>
          <Badge tone="caution" size="sm">
            <Icon name="clock" size={12} /> waiting
          </Badge>
        </div>
        {failed !== null ? (
          <p role="alert" className="mt-2 rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical">
            {failed}
          </p>
        ) : null}
        <div className="mt-3 flex gap-3">
          <Button
            size="sm"
            variant="secondary"
            fullWidth
            pending={pending === 'REJECT'}
            disabled={pending === 'APPROVE'}
            onClick={() => {
              void decide('REJECT');
            }}
          >
            Turn away
          </Button>
          <Button
            size="sm"
            fullWidth
            pending={pending === 'APPROVE'}
            disabled={pending === 'REJECT'}
            onClick={() => {
              void decide('APPROVE');
            }}
          >
            Let them in
          </Button>
        </div>
      </Card>
    </div>
  );
}
