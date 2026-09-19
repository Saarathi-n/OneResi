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
  Skeleton,
  Textarea,
  useToast,
  cn,
} from '@oneresi/ui';
import {
  COMPLAINT_CATEGORY,
  COMPLAINT_STATUS,
  COMPLAINT_TRANSITIONS,
  type ComplaintCategory,
  type ComplaintPriority,
  type ComplaintStatus,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The society's complaints, every household, filterable by status. The committee answers with a
 * state transition and a note — never a bare status flip, because the resident reads the note.
 */

interface SocietyComplaint {
  readonly id: number;
  readonly category: ComplaintCategory;
  readonly priority: ComplaintPriority;
  readonly description: string;
  /** S3-style object keys, at most three. */
  readonly photoKeys: readonly string[];
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

/** The transitions a committee member may take a complaint through, straight from the contract. */
const NEXT_STATUSES = COMPLAINT_TRANSITIONS;

const STATUS_DESCRIPTIONS: Record<ComplaintStatus, string> = {
  OPEN: 'Ticket remains open or is returned to the queue for committee review.',
  IN_PROGRESS: 'Maintenance work is underway and assigned to staff or external contractors.',
  RESOLVED: 'The issue has been resolved. The resident has 7 days to verify or reopen.',
  CLOSED: 'The ticket is finalized and archived. No further transitions possible.',
};

const PRIORITY_SEGMENTS: readonly { value: ComplaintPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const STATUS_TONE = { ...COMPLAINT_STATUS };

export default function SocietyComplaintsPage() {
  // The route's status query takes a single COMPLAINT_STATUSES value; the desk wants them all
  // and filters client-side, so no query is sent.
  const complaints = useFetch<readonly SocietyComplaint[]>('/api/complaints/society');
  const toast = useToast();
  const [filter, setFilter] = useState('ALL');
  const [openFor, setOpenFor] = useState<SocietyComplaint | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [nextPriority, setNextPriority] = useState<ComplaintPriority>('MEDIUM');
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
    setNextPriority(complaint.priority);
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
        priority: nextPriority,
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
                  {complaint.photoKeys.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {complaint.photoKeys.map((key) => (
                        <a
                          key={key}
                          href={`/api/complaints/photos/file?key=${encodeURIComponent(key)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block h-16 w-16 overflow-hidden rounded-lg border border-border"
                        >
                          <img
                            src={`/api/complaints/photos/file?key=${encodeURIComponent(key)}`}
                            alt="Attached to this complaint"
                            className="h-full w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}
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
        size="md"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setOpenFor(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              pending={pending}
              pendingLabel="Saving"
              onClick={() => void submitUpdate()}
            >
              Save update
            </Button>
          </>
        }
      >
        <div className="space-y-5 py-1">
          {/* Status Selection: Custom Paper Status Radio Cards */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="type-label font-medium text-content">
                New status <span className="text-critical">*</span>
              </span>
              <span className="type-micro text-content-subtle">
                Choose transition state
              </span>
            </div>
            <div className="space-y-2" role="radiogroup" aria-label="New status">
              {(openFor !== null ? NEXT_STATUSES[openFor.status] : []).map((status) => {
                const isSelected = nextStatus === status;
                return (
                  <label
                    key={status}
                    className={cn(
                      'relative flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all',
                      isSelected
                        ? 'border-accent bg-accent-soft/30 shadow-xs ring-1 ring-accent edge-light'
                        : 'border-border bg-surface-raised hover:border-border-strong hover:bg-surface-sunken/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="complaint-status"
                      value={status}
                      checked={isSelected}
                      onChange={() => setNextStatus(status)}
                      className="sr-only"
                    />
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface">
                      {isSelected ? (
                        <span className="h-2 w-2 rounded-full bg-accent" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone={COMPLAINT_STATUS[status].tone} size="sm">
                          {COMPLAINT_STATUS[status].label}
                        </Badge>
                      </div>
                      <p className="type-label mt-1 text-content-muted">
                        {STATUS_DESCRIPTIONS[status] ?? COMPLAINT_STATUS[status].hint ?? ''}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Priority Selection: Segmented Pill Toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="type-label font-medium text-content">Priority</span>
              <span className="type-micro text-content-subtle">
                Urgency for committee queue
              </span>
            </div>
            <div
              className="grid grid-cols-4 gap-1.5 rounded-pill border border-border bg-surface-sunken p-1"
              role="radiogroup"
              aria-label="Priority"
            >
              {PRIORITY_SEGMENTS.map((segment) => {
                const isSelected = nextPriority === segment.value;
                return (
                  <button
                    key={segment.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setNextPriority(segment.value)}
                    className={cn(
                      'focus-ring flex items-center justify-center gap-1.5 rounded-pill py-2 px-2.5 type-label transition-all',
                      isSelected
                        ? 'border border-border-strong bg-surface-raised font-semibold text-content shadow-xs edge-light'
                        : 'border border-transparent text-content-muted hover:bg-surface-raised/40 hover:text-content',
                    )}
                  >
                    <PriorityPill priority={segment.value} compact />
                    <span>{segment.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generous Note Textarea with Paper Styling */}
          <Field
            label="Note to the resident"
            required
            hint="What was done, or what happens next. This is the part they read."
          >
            <Textarea
              rows={5}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Plumber inspected leak, replacement valve ordered, water restored by evening."
              className="bg-surface font-sans"
            />
          </Field>

          {error !== null ? (
            <div
              className="rounded-xl border border-critical-border bg-critical-soft p-3 text-critical type-body"
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
