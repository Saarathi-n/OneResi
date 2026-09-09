'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  PriorityPill,
  RelativeTime,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
  useToast,
} from '@oneresi/ui';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY,
  COMPLAINT_STATUS,
  type ComplaintCategory,
  type ComplaintPriority,
  type ComplaintStatus,
} from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Complaints. The life of one is a timeline of four nodes — Reported, Being fixed, Fixed, Closed
 * (04-product-design.md) — read from the status, never a fifth invented state. Raising one asks
 * for the least that lets the committee act: category, how urgent it feels, a description.
 */

const COMPLAINTS_PATH = '/api/complaints';

interface UpdateLine {
  at: string;
  by: string;
  statusAfter: ComplaintStatus;
  note: string;
}

interface ComplaintLine {
  id: number;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  description: string;
  status: ComplaintStatus;
  raisedAt: string;
  resolvedAt: string | null;
  reopenableUntil: string | null;
  updates: readonly UpdateLine[];
}

/** The timeline nodes, in order, with how far this complaint has walked down them. */
const TIMELINE: readonly { status: ComplaintStatus; node: string }[] = [
  { status: 'OPEN', node: 'Reported' },
  { status: 'IN_PROGRESS', node: 'Being fixed' },
  { status: 'RESOLVED', node: 'Fixed' },
  { status: 'CLOSED', node: 'Closed' },
];

function timelineIndex(status: ComplaintStatus): number {
  const index = TIMELINE.findIndex((node) => node.status === status);
  return index === -1 ? 0 : index;
}

export default function ComplaintsPage() {
  const complaints = useFetch<readonly ComplaintLine[]>(COMPLAINTS_PATH);
  const toast = useToast();

  const [category, setCategory] = useState<ComplaintCategory | ''>('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('MEDIUM');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reopenId, setReopenId] = useState<number | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenPending, setReopenPending] = useState(false);

  // Pre-fill: the household's live complaint is usually the same kind as the next one, so offer
  // that category once — never overwrite a choice the person already made.
  const categoryOffered = useRef(false);
  useEffect(() => {
    if (categoryOffered.current || category !== '') return;
    if (complaints.state.state !== 'ready' || complaints.state.data.length === 0) return;
    const open = complaints.state.data.find(
      (complaint) => complaint.status === 'OPEN' || complaint.status === 'IN_PROGRESS',
    );
    if (open !== undefined) {
      setCategory(open.category);
      categoryOffered.current = true;
    }
  }, [complaints.state, category]);

  async function submit(): Promise<void> {
    setCategoryError(null);
    setDescriptionError(null);
    setFormError(null);
    if (category === '') {
      setCategoryError('Choose what kind of problem it is.');
      return;
    }
    if (description.trim().length < 10) {
      setDescriptionError('Describe the problem in a sentence or two.');
      return;
    }
    setPending(true);
    const result = await call<ComplaintLine>(COMPLAINTS_PATH, {
      method: 'POST',
      json: { category, priority, description: description.trim() },
    });
    setPending(false);
    if (result.ok) {
      setDescription('');
      setCategory('');
      setPriority('MEDIUM');
      complaints.reload();
      setExpandedId(result.data.id);
      toast.show({
        title: 'Complaint registered',
        description: 'The committee sees it in their queue. Track it here.',
        tone: 'positive',
      });
      return;
    }
    setFormError(result.error.message);
  }

  async function submitReopen(): Promise<void> {
    if (reopenId === null) return;
    if (reopenReason.trim().length < 10) {
      setReopenError('Tell us what is still wrong — a line or two.');
      return;
    }
    setReopenPending(true);
    setReopenError(null);
    const result = await call<ComplaintLine>(`/api/complaints/${reopenId}/reopen`, {
      method: 'POST',
      json: { complaintId: reopenId, reason: reopenReason.trim() },
    });
    setReopenPending(false);
    if (result.ok) {
      setReopenId(null);
      setReopenReason('');
      complaints.reload();
      return;
    }
    setReopenError(result.error.message);
  }

  return (
    <div className="space-y-6">
      <h1 className="type-title text-content">Complaints</h1>

      <Card elevation={0} className="border border-border">
        <CardHeader
          title="Report a problem"
          subtitle="Go to your society's desk, with a record of it."
        />
        <CardBody className="space-y-5">
          <Field label="What kind of problem?" required error={categoryError}>
            <Select
              options={COMPLAINT_CATEGORIES.map((value) => ({
                value,
                label: COMPLAINT_CATEGORY[value].label,
              }))}
              placeholder="Choose a category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as ComplaintCategory);
                setCategoryError(null);
              }}
            />
          </Field>
          <Field label="How urgent is it?" required>
            <Select
              options={[
                { value: 'LOW', label: 'Whenever someone can come' },
                { value: 'MEDIUM', label: 'This week' },
                { value: 'HIGH', label: 'Today or tomorrow' },
                { value: 'URGENT', label: 'Right now — water, wires, danger' },
              ]}
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')
              }
            />
          </Field>
          <Field
            label="What is wrong?"
            required
            error={descriptionError}
            hint="Where it is, what happens, and what you have already tried."
          >
            <Textarea
              rows={4}
              value={description}
              onBlur={() => {
                if (description.trim().length < 10) {
                  setDescriptionError('Describe the problem in a sentence or two.');
                } else {
                  setDescriptionError(null);
                }
              }}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          {formError !== null ? (
            <p className="type-body text-critical" role="alert">
              {formError}
            </p>
          ) : null}
          <Button
            pending={pending}
            pendingLabel="Registering your complaint"
            onClick={() => void submit()}
          >
            Register complaint
          </Button>
        </CardBody>
      </Card>

      <div>
        <h2 className="type-title text-content">Your complaints</h2>
        {complaints.state.state === 'loading' ? (
          <div className="mt-3 space-y-3">
            <Skeleton variant="block" height={96} />
            <Skeleton variant="block" height={96} />
          </div>
        ) : complaints.state.state === 'failed' ? (
          <div className="mt-3">
            <ErrorState title="Your complaints did not load" onRetry={complaints.reload} />
          </div>
        ) : complaints.state.data.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Nothing reported"
              description="When something in your home or the common areas needs the committee, report it above."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {complaints.state.data.map((complaint) => (
              <Card key={complaint.id} elevation={0} className="border border-border">
                <CardBody className="space-y-4">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                    onClick={() =>
                      setExpandedId((current) => (current === complaint.id ? null : complaint.id))
                    }
                    aria-expanded={expandedId === complaint.id}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill descriptor={COMPLAINT_STATUS[complaint.status]} size="sm" />
                        <PriorityPill priority={complaint.priority} size="sm" compact />
                        <span className="type-label text-content-subtle">
                          {COMPLAINT_CATEGORY[complaint.category].label}
                        </span>
                      </div>
                      <p className="type-body mt-2 line-clamp-2 text-content">
                        {complaint.description}
                      </p>
                      <p className="type-micro mt-1 text-content-subtle">
                        Raised <RelativeTime value={complaint.raisedAt} size="micro" />
                      </p>
                    </div>
                    <span className="type-label text-accent">
                      {expandedId === complaint.id ? 'Hide' : 'Track'}
                    </span>
                  </button>

                  {expandedId === complaint.id ? (
                    <div className="space-y-4 border-t border-border pt-4">
                      {/* The four-node timeline: where it is, and where it has been. */}
                      <ol className="flex items-center gap-1" aria-label="Complaint progress">
                        {TIMELINE.map((node, index) => {
                          const reached = index <= timelineIndex(complaint.status);
                          return (
                            <li key={node.status} className="flex-1">
                              <div
                                className={
                                  reached
                                    ? 'h-1 rounded-full bg-accent'
                                    : 'h-1 rounded-full bg-surface-sunken'
                                }
                                aria-hidden
                              />
                              <p
                                className={
                                  reached
                                    ? 'type-micro mt-1 text-content'
                                    : 'type-micro mt-1 text-content-subtle'
                                }
                              >
                                {node.node}
                              </p>
                            </li>
                          );
                        })}
                      </ol>

                      <ul className="space-y-3">
                        {complaint.updates.map((update) => (
                          <li
                            key={`${update.at}-${update.statusAfter}-${update.by}`}
                            className="border-l-2 border-border pl-3"
                          >
                            <p className="type-label text-content">
                              {COMPLAINT_STATUS[update.statusAfter].label} — {update.by}
                            </p>
                            <p className="type-body text-content-muted">{update.note}</p>
                            <p className="type-micro text-content-subtle">
                              <RelativeTime value={update.at} size="micro" />
                            </p>
                          </li>
                        ))}
                      </ul>

                      {complaint.status === 'RESOLVED' && complaint.reopenableUntil !== null ? (
                        reopenId === complaint.id ? (
                          <div className="space-y-3 rounded-xl bg-critical-soft p-4">
                            <Field label="What is still wrong?" required error={reopenError}>
                              <Textarea
                                rows={3}
                                value={reopenReason}
                                onChange={(event) => setReopenReason(event.target.value)}
                              />
                            </Field>
                            <div className="flex gap-2">
                              <Button
                                variant="danger"
                                size="sm"
                                pending={reopenPending}
                                pendingLabel="Reopening"
                                onClick={() => void submitReopen()}
                              >
                                Reopen complaint
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setReopenId(null);
                                  setReopenError(null);
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setReopenId(complaint.id)}
                          >
                            It came back — reopen
                          </Button>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
