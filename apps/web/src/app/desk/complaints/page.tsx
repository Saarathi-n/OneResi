'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PriorityPill,
  RelativeTime,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@oneresi/ui';
import {
  COMPLAINT_CATEGORY,
  COMPLAINT_STATUS,
  type ComplaintCategory,
  type ComplaintPriority,
  type ComplaintStatus,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The society's complaints, every household, filterable by status. The committee answers with a
 * state transition and a note — never a bare status flip, because the resident reads the note
 * (D-20: resolvedAt survives every later update, so a re-opened complaint keeps its history).
 */

interface SocietyComplaint {
  readonly id: number;
  readonly category: ComplaintCategory;
  readonly priority: ComplaintPriority;
  readonly description: string;
  readonly status: ComplaintStatus;
  readonly raisedAt: string;
  readonly resolvedAt: string | null;
  readonly updates: readonly {
    readonly at: string;
    readonly by: string;
    readonly statusAfter: ComplaintStatus;
    readonly note: string;
  }[];
}

const FILTERS: readonly { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  ...Object.keys(COMPLAINT_STATUS).map((status) => ({
    value: status,
    label: COMPLAINT_STATUS[status as ComplaintStatus].label,
  })),
];

/** The transitions a committee member may take a complaint through. */
const NEXT_STATUSES: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

const STATUS_TONE = { ...COMPLAINT_STATUS };

export default function SocietyComplaintsPage() {
  // The route's status query takes a single COMPLAINT_STATUSES value; the desk wants them all
  // and filters client-side, so no query is sent.
  const complaints = useFetch<readonly SocietyComplaint[]>('/api/complaints/society');
  const toast = useToast();
  const [filter, setFilter] = useState('ALL');
  const [openFor, setOpenFor] = useState<SocietyComplaint | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = useMemo(() => {
    if (complaints.state.state !== 'ready') return [] as SocietyComplaint[];
    const all = complaints.state.data;
    return filter === 'ALL' ? all : all.filter((complaint) => complaint.status === filter);
  }, [complaints.state, filter]);

  function openUpdate(complaint: SocietyComplaint): void {
    const options = NEXT_STATUSES[complaint.status];
    if (options.length === 0) {
      toast.show({
        title: 'This complaint is closed',
        description: 'A closed complaint has no further transitions.',
        tone: 'neutral',
      });
      return;
    }
    setOpenFor(complaint);
    setNextStatus(options[0] ?? '');
    setNote('');
    setError(null);
  }

  async function submitUpdate(): Promise<void> {
    if (openFor === null) return;
    if (note.trim().length < 4) {
      setError('Write the note the resident will read.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await call<null>(`/api/complaints/${openFor.id}/updates`, {
      method: 'POST',
      json: {
        complaintId: openFor.id,
        status: nextStatus,
        note: note.trim(),
      },
    });
    setPending(false);
    if (result.ok) {
      setOpenFor(null);
      complaints.reload();
      toast.show({ title: 'Complaint updated', tone: 'positive' });
      return;
    }
    setError(result.error.message);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Society complaints</h1>
        <p className="type-body mt-1 text-content-muted">
          Every household&apos;s complaints on one screen. Answer with a state and a note — the
          note is what the resident reads.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Status filter">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {complaints.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={120} />
          <Skeleton variant="block" height={120} />
        </div>
      ) : complaints.state.state === 'failed' ? (
        <ErrorState title="Complaints did not load" onRetry={complaints.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing in this filter"
          description="Either no complaints match, or the society is having a very good week."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((complaint) => {
            const isOpen = expanded === complaint.id;
            return (
              <li
                key={complaint.id}
                className="rounded-xl border border-border bg-surface-raised"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                  <Badge tone={STATUS_TONE[complaint.status].tone} size="sm">
                    {STATUS_TONE[complaint.status].label}
                  </Badge>
                  <PriorityPill priority={complaint.priority} />
                  <Badge tone="neutral" size="sm">
                    {COMPLAINT_CATEGORY[complaint.category].label}
                  </Badge>
                  <span className="type-micro text-content-subtle">
                    <RelativeTime value={complaint.raisedAt} size="micro" />
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded(isOpen ? null : complaint.id)}
                    >
                      {isOpen ? 'Hide' : 'History'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={NEXT_STATUSES[complaint.status].length === 0}
                      onClick={() => openUpdate(complaint)}
                    >
                      Update
                    </Button>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <p className="type-body text-content">{complaint.description}</p>
                  {isOpen ? (
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      {complaint.updates.length === 0 ? (
                        <p className="type-body text-content-subtle">
                          No updates yet — this complaint is waiting for its first answer.
                        </p>
                      ) : (
                        complaint.updates.map((update) => (
                          <div
                            key={`${update.at}-${update.statusAfter}-${update.by}`}
                            className="flex flex-wrap items-baseline gap-2"
                          >
                            <Badge
                              tone={STATUS_TONE[update.statusAfter].tone}
                              size="sm"
                            >
                              {STATUS_TONE[update.statusAfter].label}
                            </Badge>
                            <span className="type-micro text-content-subtle">
                              {update.by} · <RelativeTime value={update.at} size="micro" />
                            </span>
                            <p className="type-body w-full text-content-muted">{update.note}</p>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={openFor !== null}
        onClose={() => setOpenFor(null)}
        title="Update the complaint"
        description="Pick the new state and write the note. The resident sees both the moment you save."
      >
        <div className="space-y-4">
          <Field label="New status" required>
            <Select
              options={(openFor !== null ? NEXT_STATUSES[openFor.status] : []).map((status) => ({
                value: status,
                label: COMPLAINT_STATUS[status].label,
              }))}
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value)}
            />
          </Field>
          <Field
            label="Note to the resident"
            required
            hint="What was done, or what happens next. This is the part they read."
          >
            <Textarea
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Plumber visited, part replaced, water restored by evening."
            />
          </Field>
          {error !== null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpenFor(null)}>
              Cancel
            </Button>
            <Button pending={pending} pendingLabel="Saving" onClick={() => void submitUpdate()}>
              Save update
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
