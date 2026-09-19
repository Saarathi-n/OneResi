'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  RelativeTime,
  Skeleton,
  Textarea,
  useToast,
} from '@grihaone/ui';
import { UNIT_TYPE, type UnitType } from '@grihaone/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The registration queue: every application the committee must answer, one screen, oldest first.
 * A claim (D-04) is shown as the words the applicant typed — never re-labelled or guessed — and
 * resolved only when the application is approved. Declining must give a reason; approving may.
 */

interface ApplicationLine {
  userId: number;
  name: string;
  email: string;
  phone: string;
  appliedAt: string;
  claim: {
    blockName: string;
    unitLabel: string;
    unitType: UnitType;
    note: string | null;
  } | null;
}

type Decision = 'APPROVE' | 'DECLINE';

export default function QueuePage() {
  const applications = useFetch<readonly ApplicationLine[]>('/api/applications');
  const toast = useToast();
  const [open, setOpen] = useState<ApplicationLine | null>(null);
  const [decision, setDecision] = useState<Decision>('APPROVE');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function ask(next: ApplicationLine, which: Decision): void {
    setOpen(next);
    setDecision(which);
    setReason('');
    setError(null);
  }

  async function decide(): Promise<void> {
    if (open === null) return;
    const trimmed = reason.trim();
    if (decision === 'DECLINE' && trimmed.length < 4) {
      setError('A decline needs a reason the applicant can read.');
      return;
    }
    setPending(true);
    const result = await call<null>('/api/applications/decision', {
      method: 'POST',
      json: {
        userId: open.userId,
        decision,
        ...(trimmed.length === 0 ? {} : { reason: trimmed }),
      },
    });
    setPending(false);
    if (result.ok) {
      setOpen(null);
      applications.reload();
      toast.show({
        title: decision === 'APPROVE' ? `${open.name} approved` : `${open.name} declined`,
        description:
          decision === 'APPROVE'
            ? 'They can sign in and the society has a new member.'
            : 'They get an email with your reason.',
        tone: decision === 'APPROVE' ? 'positive' : 'neutral',
      });
      return;
    }
    setError(result.error.message);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Registration queue</h1>
        <p className="type-body mt-1 text-content-muted">
          Approve and the home is theirs. Decline and they hear your reason. Nothing here waits on
          anyone else.
        </p>
      </div>

      {applications.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={140} />
          <Skeleton variant="block" height={140} />
        </div>
      ) : applications.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState title="The queue did not load" onRetry={applications.reload} />
          </CardBody>
        </Card>
      ) : applications.state.data.length === 0 ? (
        <EmptyState
          title="No one is waiting"
          description="Applications land here the moment someone finishes registering. An empty queue means every one has been answered."
        />
      ) : (
        <ul className="space-y-3">
          {applications.state.data.map((application) => (
            <li key={application.userId}>
              <Card elevation={1}>
                <CardHeader
                  title={application.name}
                  subtitle={`${application.email} · ${application.phone}`}
                  actions={
                    <span className="type-micro text-content-subtle">
                      <RelativeTime value={application.appliedAt} size="micro" />
                    </span>
                  }
                />
                <CardBody className="mt-3 space-y-2">
                  {application.claim === null ? (
                    <p className="type-body text-content-muted">
                      Registered against a home already on the society list.
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-lg bg-surface-sunken p-3">
                      <div className="flex items-center gap-2">
                        <Badge tone="caution" size="sm">
                          Claim
                        </Badge>
                        <span className="type-label text-content">
                          {application.claim.blockName} · {application.claim.unitLabel}
                        </span>
                      </div>
                      <p className="type-body text-content-muted">
                        Not on the unit list — the applicant typed these words themselves. Shown
                        exactly as given and resolved only at approval.
                      </p>
                      <p className="type-body text-content-muted">
                        {UNIT_TYPE[application.claim.unitType].label}
                      </p>
                      {application.claim.note !== null && application.claim.note.length > 0 ? (
                        <p className="type-body text-content-subtle italic">
                          “{application.claim.note}”
                        </p>
                      ) : null}
                    </div>
                  )}
                </CardBody>
                <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={() => ask(application, 'APPROVE')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => ask(application, 'DECLINE')}>
                    Decline
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={
          decision === 'APPROVE'
            ? `Approve ${open?.name ?? ''}`
            : `Decline ${open?.name ?? ''}`
        }
        description={
          decision === 'APPROVE'
            ? open?.claim !== null
              ? 'Their claim becomes a real home in the society — the block and unit will be created as they described it.'
              : 'They get access to their home and a welcome email.'
            : 'They get an email with your reason. A decline must be explainable.'
        }
      >
        <div className="space-y-4">
          {decision === 'APPROVE' ? (
            <Field label="Note to the applicant (optional)" optional>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder="Anything worth saying alongside the approval."
              />
            </Field>
          ) : (
            <Field label="Reason" required hint="Shown in the email. Write it for them.">
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder="What they should do next, or what the application got wrong."
              />
            </Field>
          )}
          {error !== null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              variant={decision === 'APPROVE' ? 'primary' : 'danger'}
              pending={pending}
              pendingLabel={decision === 'APPROVE' ? 'Approving' : 'Declining'}
              onClick={() => void decide()}
            >
              {decision === 'APPROVE' ? 'Approve' : 'Decline'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
