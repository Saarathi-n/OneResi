'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import * as C from '@oneresi/contracts';
import { Button, Card } from '@oneresi/ui';
import { call } from '@/lib/api';
import { verdictClass } from '@/lib/motion';
import { enqueue, newIdempotencyKey } from '@/lib/replay-queue';
import type { GateDecisionWire } from '@/lib/types';
import { addOpenCheckIn, type OpenCheckIn } from '../lib/checkin-store';
import { formatTimeOfDay } from '../lib/time';

/**
 * The answer to a code, as a decision (D-40): never a row, never a table. ADMIT says who the
 * visitor is, why they are here, where they are going and who expects them, then offers one
 * heavyweight action — check them in. REFUSE says exactly one thing, the reason, in the largest
 * type on the screen, because at a gate there is nothing else worth reading.
 *
 * The check-in write is idempotent, so if the network is down when the guard presses the button
 * the write is queued with its key and the visitor is recorded locally — the kiosk must never
 * make a guard wait on a spinner for a decision they have already made.
 */

interface DecisionCardProps {
  readonly decision: GateDecisionWire;
  readonly reduced: boolean;
  /** Called once the check-in is recorded (on the server or queued) so the kiosk's inside list updates. */
  readonly onRecorded?: ((entry: OpenCheckIn) => void) | undefined;
  readonly onReset: () => void;
}

export function DecisionCard({
  decision,
  reduced,
  onRecorded,
  onReset,
}: DecisionCardProps): ReactNode {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [recordedAt, setRecordedAt] = useState<string | null>(null);

  if (decision.verdict === 'REFUSE') {
    return (
      <div role="status" aria-live="polite">
        <Card tone="critical" padding="roomy" className={verdictClass('REFUSE', reduced)}>
          <p className="kiosk-headline text-critical">TURN AWAY</p>
          <p className="mt-4 type-title font-medium">{C.GATE_REFUSAL_REASON[decision.reason].label}</p>
          <p className="mt-2 type-body text-content-subtle">Do not let this person in.</p>
          <div className="mt-8">
            <Button size="kiosk" variant="secondary" fullWidth onClick={onReset}>
              Next visitor
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // The union narrowed to ADMIT. Captured in a const so the narrowing survives into the
  // closures below — a parameter's narrowing does not.
  const admit = decision;

  async function checkIn(): Promise<void> {
    setPending(true);
    setFailure(null);
    const idempotencyKey = newIdempotencyKey();
    const outcome = await call('/api/gate/entry', {
      method: 'POST',
      json: { passId: admit.passId, action: 'CHECK_IN', idempotencyKey },
    });
    setPending(false);

    if (outcome.ok) {
      record();
      return;
    }

    if ('network' in outcome && outcome.network) {
      // The visitor is walking through either way. Queue the write with the key it was born
      // with — a replay cannot log the entry twice — and record locally so the check-out list
      // is correct on this device.
      enqueue({
        path: '/api/gate/entry',
        method: 'POST',
        body: { passId: admit.passId, action: 'CHECK_IN', idempotencyKey },
        description: `Check-in for ${admit.visitorName}`,
      });
      record();
      return;
    }

    setFailure(outcome.error.message);
  }

  function record(): void {
    const at = new Date().toISOString();
    const entry: OpenCheckIn = {
      passId: admit.passId,
      visitorName: admit.visitorName,
      purpose: admit.purpose,
      destination: admit.destination,
      checkedInAt: at,
    };
    addOpenCheckIn(entry);
    onRecorded?.(entry);
    setRecordedAt(at);
  }

  if (recordedAt !== null) {
    return (
      <div role="status" aria-live="polite">
        <Card tone="positive" padding="roomy" className={verdictClass('ADMIT', reduced)}>
          <p className="kiosk-headline text-positive">CHECKED IN</p>
          <p className="mt-4 type-title font-medium">{admit.visitorName}</p>
          <p className="mt-1 type-body text-content-subtle">
            Going to {admit.destination} · at {formatTimeOfDay(recordedAt)}
          </p>
          <p className="mt-4 type-label text-content-subtle">
            They are on the inside list for today. Check them out from the gate screen when they leave.
          </p>
          <div className="mt-8">
            <Button size="kiosk" fullWidth onClick={onReset}>
              Next visitor
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite">
      <Card tone="positive" padding="roomy" className={verdictClass('ADMIT', reduced)}>
        <p className="kiosk-headline text-positive">LET THEM IN</p>
        <p className="mt-4 text-[28px] font-semibold leading-tight">{admit.visitorName}</p>
        <dl className="mt-6 flex flex-col gap-5">
          <div>
            <dt className="type-label uppercase tracking-wide text-content-subtle">Coming for</dt>
            <dd className="mt-1 type-body font-medium">{admit.purpose}</dd>
          </div>
          <div>
            <dt className="type-label uppercase tracking-wide text-content-subtle">Going to</dt>
            <dd className="mt-1 type-body font-medium">{admit.destination}</dd>
          </div>
          <div>
            <dt className="type-label uppercase tracking-wide text-content-subtle">Expected by</dt>
            <dd className="mt-1 type-body font-medium">{admit.hostName}</dd>
          </div>
        </dl>
        {failure !== null ? (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical"
          >
            {failure}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col gap-3">
          <Button
            size="kiosk"
            fullWidth
            pending={pending}
            pendingLabel="Recording the entry"
            onClick={() => {
              void checkIn();
            }}
          >
            Check them in
          </Button>
          <Button size="kiosk" variant="secondary" fullWidth disabled={pending} onClick={onReset}>
            Next visitor
          </Button>
        </div>
      </Card>
    </div>
  );
}
