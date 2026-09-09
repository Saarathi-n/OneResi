'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Field,
  PriorityPill,
  RelativeTime,
  Select,
  Sheet,
  StatusPill,
  Tabs,
  Textarea,
  useToast,
} from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { ComplaintWire } from '@/lib/types';

/**
 * Every complaint in the society, worked top to bottom. The one action this desk owns is the status
 * update — and it always carries a note, because "Being fixed" with nothing under it teaches the
 * resident nothing. The resident sees the same note on their screen.
 */

const STATUS_FILTERS = ['ALL', ...C.COMPLAINT_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function filterLabel(filter: StatusFilter): string {
  return filter === 'ALL' ? 'All' : C.COMPLAINT_STATUS[filter].label;
}

export default function DeskComplaintsPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [updating, setUpdating] = useState<ComplaintWire | null>(null);

  const complaints = useAsync(
    () =>
      simple<readonly ComplaintWire[]>(
        filter === 'ALL' ? '/api/complaints/society' : `/api/complaints/society?status=${filter}`,
      ),
    [filter],
  );

  const refresh = useCallback(async () => {
    complaints.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [complaints]);

  return (
    <Shell title="Complaints" tabs={COMMITTEE_TABS} activeTab="/desk/complaints" onRefresh={refresh}>
      <Tabs
        label="Filter by status"
        value={filter}
        onValueChange={(value) => {
          setFilter(value as StatusFilter);
        }}
        items={STATUS_FILTERS.map((value) => ({ value, label: filterLabel(value) }))}
      >
        <AsyncView
          state={complaints.state}
          skeleton={<CardListSkeleton rows={3} />}
          empty={
            <div className="mt-3 rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
              <p className="type-body font-medium">
                {filter === 'ALL' ? 'No complaints in the society' : `Nothing marked ${filterLabel(filter).toLowerCase()}`}
              </p>
              <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
                {filter === 'ALL'
                  ? 'A quiet society. The moment someone raises a complaint it lands here.'
                  : 'Switch the filter to see the rest.'}
              </p>
            </div>
          }
          onRetry={complaints.reload}
          render={(list) => (
            <div className="mt-3 flex flex-col gap-3">
              {list.map((complaint) => (
                <div key={complaint.id} className="row-in" style={rowStyle(0, reduced)}>
                  <Card tone={C.COMPLAINT_STATUS[complaint.status].tone}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="type-body font-medium">
                          {C.COMPLAINT_CATEGORY[complaint.category].label}
                        </p>
                        <p className="type-label text-content-muted">
                          Raised <RelativeTime value={complaint.raisedAt} size="label" />
                          {complaint.resolvedAt !== null ? (
                            <>
                              {' '}· fixed <RelativeTime value={complaint.resolvedAt} size="label" />
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusPill descriptor={C.COMPLAINT_STATUS[complaint.status]} size="sm" />
                        <PriorityPill priority={complaint.priority} size="sm" />
                      </div>
                    </div>

                    <p className="mt-2 type-body text-content-muted">{complaint.description}</p>

                    {complaint.updates.length > 0 ? (
                      <div className="mt-3 border-t border-border pt-3">
                        <ul className="flex flex-col gap-2">
                          {complaint.updates.slice(-2).map((update) => (
                            <li key={`${update.at}-${update.statusAfter}`} className="flex flex-col">
                              <p className="type-label text-content-muted">
                                {update.by} marked it {C.COMPLAINT_STATUS[update.statusAfter].label.toLowerCase()} ·{' '}
                                <RelativeTime value={update.at} size="label" />
                              </p>
                              <p className="type-label text-content-subtle">{update.note}</p>
                            </li>
                          ))}
                        </ul>
                        {complaint.updates.length > 2 ? (
                          <p className="mt-1 type-label text-content-subtle">
                            And {complaint.updates.length - 2} earlier{' '}
                            {complaint.updates.length - 2 === 1 ? 'update' : 'updates'}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {C.COMPLAINT_TRANSITIONS[complaint.status].length > 0 ? (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          fullWidth
                          variant="secondary"
                          onClick={() => {
                            setUpdating(complaint);
                          }}
                        >
                          Update status
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                </div>
              ))}
            </div>
          )}
        />
      </Tabs>

      {updating !== null ? (
        <UpdateSheet
          complaint={updating}
          onClose={() => {
            setUpdating(null);
          }}
          onUpdated={() => {
            setUpdating(null);
            complaints.reload();
            toast.show({
              title: 'The resident has been told',
              description: 'Your note is on their complaint now.',
            });
          }}
        />
      ) : null}
    </Shell>
  );
}

function UpdateSheet({
  complaint,
  onClose,
  onUpdated,
}: {
  readonly complaint: ComplaintWire;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
}): ReactNode {
  const [status, setStatus] = useState<string>(complaint.status);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ status?: string; note?: string }>({});

  // The state machine, not a guess: the desk is offered exactly the transitions the contract permits.
  const nextStatuses = C.COMPLAINT_TRANSITIONS[complaint.status];

  async function submit(): Promise<void> {
    if (pending) return;
    const problems: { status?: string; note?: string } = {};
    if (!C.COMPLAINT_STATUSES.includes(status as C.ComplaintStatus)) {
      problems.status = 'Pick where this complaint stands';
    }
    if (note.trim().length < 4) problems.note = 'Say what changed — the resident reads this';
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await simple<ComplaintWire>(`/api/complaints/${complaint.id}/updates`, {
      method: 'POST',
      json: { complaintId: complaint.id, status, note: note.trim() },
    });
    setPending(false);
    if (result.ok) {
      onUpdated();
      return;
    }
    if (result.error.field === 'status') setErrors({ status: result.error.message });
    else if (result.error.field === 'note') setErrors({ note: result.error.message });
    else setErrors({ note: result.error.message });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Update the complaint"
      description="The new status and your note appear on the resident's screen the moment you save."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Saving" onClick={() => { void submit(); }}>
          Save update
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <p className="type-label text-content-subtle">The complaint</p>
          <p className="type-body">{C.COMPLAINT_CATEGORY[complaint.category].label}</p>
          <p className="mt-1 type-label text-content-muted">{complaint.description}</p>
        </Card>

        <Field label="Where it stands now" required error={errors.status}>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
            options={nextStatuses.map((value) => ({ value, label: C.COMPLAINT_STATUS[value].label }))}
          />
        </Field>

        <Field
          label="Note"
          required
          error={errors.note}
          hint={
            status === 'RESOLVED'
              ? 'What was done, in a line — the resident can reopen for 7 days if it comes back.'
              : 'What is happening — a vendor has been called, a part is ordered, whatever is true.'
          }
        >
          <Textarea
            value={note}
            rows={3}
            maxLength={1000}
            showCount
            invalid={errors.note !== undefined}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
      </div>
    </Sheet>
  );
}
