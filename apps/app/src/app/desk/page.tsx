'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Field, RelativeTime, Sheet, StatusPill, Textarea, useToast } from '@grihaone/ui';
import * as C from '@grihaone/contracts';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { ApplicationWire } from '@/lib/types';

/**
 * The registration queue: every neighbour waiting to be let into the system. A claim's words are
 * shown exactly as the applicant wrote them — the desk judges the claim, and paraphrasing it would
 * judge something else. Approval is one tap; a decline has to say why, because the applicant sees
 * the reason and a bare refusal tells them nothing.
 */
export default function DeskQueuePage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [declining, setDeclining] = useState<ApplicationWire | null>(null);

  const queue = useAsync(() => simple<readonly ApplicationWire[]>('/api/applications'), []);

  const refresh = useCallback(async () => {
    queue.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [queue]);

  async function decide(
    application: ApplicationWire,
    decision: 'APPROVE' | 'DECLINE',
    reason?: string,
  ): Promise<boolean> {
    const result = await simple<null>('/api/applications/decision', {
      method: 'POST',
      json: {
        userId: application.userId,
        decision,
        ...(reason !== undefined && reason !== '' ? { reason } : {}),
      },
    });
    if (result.ok) {
      toast.show({
        title:
          decision === 'APPROVE'
            ? `${application.name} is in`
            : `${application.name} was declined`,
        description:
          decision === 'APPROVE'
            ? 'They can sign in with the password they chose.'
            : 'They were told why, in the words you wrote.',
      });
      queue.reload();
      return true;
    }
    toast.show({ title: 'That did not go through', description: result.error.message, tone: 'critical' });
    return false;
  }

  return (
    <Shell title="Registration queue" tabs={COMMITTEE_TABS} activeTab="/desk" onRefresh={refresh}>
      <AsyncView
        state={queue.state}
        skeleton={<CardListSkeleton rows={3} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">The queue is empty</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              New neighbours appear here the moment they apply. Everyone after the first account
              waits for this desk.
            </p>
          </div>
        }
        onRetry={queue.reload}
        render={(list) => (
          <div className="flex flex-col gap-3">
            <p className="type-label text-content-subtle">
              {list.length} waiting {list.length === 1 ? 'applicant' : 'applicants'}
            </p>
            {list.map((application, index) => (
              <div key={application.userId} className="row-in" style={rowStyle(index, reduced)}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="type-body font-medium">{application.name}</p>
                      <p className="truncate type-label text-content-subtle">{application.email}</p>
                      <p className="type-label text-content-muted">
                        {application.phone} · applied <RelativeTime value={application.appliedAt} size="label" />
                      </p>
                    </div>
                    <StatusPill descriptor={C.USER_STATUS.PENDING} size="sm" />
                  </div>

                  {application.claim !== null ? (
                    <div className="mt-3 rounded-lg border border-border bg-surface-sunken px-3 py-2">
                      <p className="type-micro uppercase tracking-wide text-content-subtle">Their claim</p>
                      <p className="type-label">
                        {application.claim.blockName}, {application.claim.unitLabel} ·{' '}
                        {C.UNIT_TYPE[application.claim.unitType].label}
                      </p>
                      {application.claim.note !== null ? (
                        <p className="mt-1 type-label text-content-muted">&ldquo;{application.claim.note}&rdquo;</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 type-label text-content-subtle">
                      No claim attached — approve only if you know them.
                    </p>
                  )}

                  <div className="mt-3 flex gap-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      fullWidth
                      onClick={() => {
                        setDeclining(application);
                      }}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      fullWidth
                      onClick={() => {
                        void decide(application, 'APPROVE');
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
      />

      {declining !== null ? (
        <DeclineSheet
          application={declining}
          onClose={() => {
            setDeclining(null);
          }}
          onDeclined={async (reason) => {
            const done = await decide(declining, 'DECLINE', reason);
            if (done) setDeclining(null);
            return done;
          }}
        />
      ) : null}
    </Shell>
  );
}

function DeclineSheet({
  application,
  onClose,
  onDeclined,
}: {
  readonly application: ApplicationWire;
  readonly onClose: () => void;
  readonly onDeclined: (reason: string) => Promise<boolean>;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    if (reason.trim().length < 4) {
      setError('Say why in a line — the applicant sees exactly this.');
      return;
    }
    setError(null);
    setPending(true);
    // The parent closes the sheet on success; on failure it has already said why, and the
    // reason stays on screen to be edited and sent again.
    const done = await onDeclined(reason.trim());
    if (!done) setPending(false);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Decline ${application.name}`}
      description="They have applied and are waiting. The reason you write is shown to them."
      pending={pending}
      footer={
        <Button
          size="lg"
          variant="danger"
          fullWidth
          pending={pending}
          pendingLabel="Declining"
          onClick={() => {
            void submit();
          }}
        >
          Decline the application
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <p className="type-label text-content-subtle">The claim</p>
          <p className="type-body">
            {application.claim !== null
              ? `${application.claim.blockName}, ${application.claim.unitLabel}`
              : 'No claim attached'}
          </p>
          {application.claim?.note !== null && application.claim !== null ? (
            <p className="mt-1 type-label text-content-subtle">&ldquo;{application.claim.note}&rdquo;</p>
          ) : null}
        </Card>

        <Field label="Reason" required hint="For example: that flat is already occupied, or the name does not match the owner records.">
          <Textarea
            value={reason}
            rows={3}
            maxLength={280}
            showCount
            invalid={error !== null}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>

        {error !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
