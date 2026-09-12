'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Field, PriorityPill, RelativeTime, Select, Sheet, StatusPill, Textarea, useToast } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple, uploadPhoto, photoUrl } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { ComplaintWire } from '@/lib/types';

/**
 * The household's complaints: what is open, what the committee has said, and the one action a
 * resident owns after the fact — reopening a "fixed" complaint that came back, inside the window
 * the society set. Categories and priorities are the committee's vocabulary, so they are labelled,
 * never shown raw.
 */

const CATEGORY_OPTIONS = C.COMPLAINT_CATEGORIES.map((category) => ({
  value: category,
  label: C.COMPLAINT_CATEGORY[category].label,
}));

const PRIORITY_OPTIONS = C.COMPLAINT_PRIORITIES.map((priority) => ({
  value: priority,
  label: C.COMPLAINT_PRIORITY[priority].label,
}));

export default function ComplaintsPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [raising, setRaising] = useState(false);
  const [reopening, setReopening] = useState<ComplaintWire | null>(null);

  const complaints = useAsync(() => simple<readonly ComplaintWire[]>('/api/complaints'), []);

  const refresh = useCallback(async () => {
    complaints.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [complaints]);

  return (
    <Shell
      title="Complaints"
      tabs={RESIDENT_TABS}
      activeTab="/home/complaints"
      onRefresh={refresh}
      headerRight={
        <Button size="sm" leadingIcon={<Icon name="plus" size={16} />} onClick={() => { setRaising(true); }}>
          Raise
        </Button>
      }
    >
      <AsyncView
        state={complaints.state}
        skeleton={<CardListSkeleton rows={3} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">Nothing raised</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              A leaking tap, a broken light in the stairwell, a gate that will not shut — raise it here
              and the committee sees it in their queue.
            </p>
            <div className="mt-4 flex justify-center">
              <Button size="sm" onClick={() => { setRaising(true); }}>
                Raise a complaint
              </Button>
            </div>
          </div>
        }
        onRetry={complaints.reload}
        render={(list) => (
          <div className="flex flex-col gap-3">
            {list.map((complaint, index) => (
              <div key={complaint.id} className="row-in" style={rowStyle(index, reduced)}>
                <ComplaintCard
                  complaint={complaint}
                  onReopen={() => {
                    setReopening(complaint);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      />

      {raising ? (
        <RaiseSheet
          onClose={() => {
            setRaising(false);
          }}
          onRaised={() => {
            setRaising(false);
            complaints.reload();
            toast.show({
              title: 'Complaint raised',
              description: 'The committee has it in their queue.',
            });
          }}
        />
      ) : null}

      {reopening !== null ? (
        <ReopenSheet
          complaint={reopening}
          onClose={() => {
            setReopening(null);
          }}
          onReopened={() => {
            setReopening(null);
            complaints.reload();
            toast.show({
              title: 'Complaint reopened',
              description: 'The committee has been told it is not fixed after all.',
            });
          }}
        />
      ) : null}
    </Shell>
  );
}

/** True while the society's reopen window for this complaint is still open. */
function reopenable(complaint: ComplaintWire): boolean {
  return (
    complaint.status === 'RESOLVED' &&
    complaint.reopenableUntil !== null &&
    new Date(complaint.reopenableUntil).getTime() > Date.now()
  );
}

function ComplaintCard({
  complaint,
  onReopen,
}: {
  readonly complaint: ComplaintWire;
  readonly onReopen: () => void;
}): ReactNode {
  return (
    <Card tone={C.COMPLAINT_STATUS[complaint.status].tone}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="type-body font-medium">{C.COMPLAINT_CATEGORY[complaint.category].label}</p>
          <p className="type-label text-content-muted">
            Raised <RelativeTime value={complaint.raisedAt} size="label" />
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
            {complaint.updates.map((update) => (
              <li key={`${update.at}-${update.statusAfter}`} className="flex flex-col">
                <p className="type-label text-content-muted">
                  {update.by} marked it {C.COMPLAINT_STATUS[update.statusAfter].label.toLowerCase()} ·{' '}
                  <RelativeTime value={update.at} size="label" />
                </p>
                <p className="type-label text-content-subtle">{update.note}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reopenable(complaint) ? (
        <div className="mt-3">
          <Button size="sm" variant="secondary" fullWidth onClick={onReopen}>
            Still broken? Reopen
          </Button>
          <p className="mt-1 text-center type-label text-content-muted">
            Window open till <RelativeTime value={complaint.reopenableUntil ?? complaint.raisedAt} size="label" />
          </p>
        </div>
      ) : complaint.status === 'RESOLVED' && complaint.reopenableUntil !== null ? (
        <p className="mt-2 type-label text-content-muted">
          The reopen window for this one has passed. Raise a fresh complaint if it comes back.
        </p>
      ) : null}
    </Card>
  );
}

function RaiseSheet({
  onClose,
  onRaised,
}: {
  readonly onClose: () => void;
  readonly onRaised: () => void;
}): ReactNode {
  const [category, setCategory] = useState<string>('');
  const [priority, setPriority] = useState<string>('MEDIUM');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ category?: string; description?: string }>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const problems: { category?: string; description?: string } = {};
    if (category === '') problems.category = 'Pick what this is about';
    if (description.trim().length < 10) problems.description = 'Describe the problem in a sentence or two';
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setPending(true);

    const result = await simple<ComplaintWire>('/api/complaints', {
      method: 'POST',
      json: {
        category,
        priority,
        description: description.trim(),
        photoKeys: photos,
      },
    });
    setPending(false);
    if (result.ok) {
      onRaised();
      return;
    }
    if (result.error.field === 'category') setErrors({ category: result.error.message });
    else if (result.error.field === 'description') setErrors({ description: result.error.message });
    else if (result.error.field === 'priority') setErrors({ description: result.error.message });
    else setErrors({ description: result.error.message });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Raise a complaint"
      description="It goes straight to the committee's queue with your flat attached."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Raising" onClick={() => { void submit(); }}>
          Raise complaint
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What is it about" required error={errors.category}>
          <Select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
            placeholder="Pick a category"
            invalid={errors.category !== undefined}
            options={CATEGORY_OPTIONS}
          />
        </Field>

        <Field label="How urgent" required hint="Urgent means someone could get hurt or property is being damaged.">
          <Select
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
            }}
            options={PRIORITY_OPTIONS}
          />
        </Field>

        <Field label="Describe the problem" required error={errors.description}>
          <Textarea
            value={description}
            rows={4}
            maxLength={2000}
            showCount
            invalid={errors.description !== undefined}
            placeholder="For example: the tap in the kitchen has been leaking since Tuesday and the floor stays wet."
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>

        <Field
          label="Photos"
          hint="Up to three. The first one is what the committee sees first."
          error={photoError === null ? undefined : photoError}
        >
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((key) => (
              <div key={key} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                                <img src={photoUrl(key)} alt="Attached" className="h-full w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-overlay text-xs text-white"
                  aria-label="Remove this photo"
                  onClick={() => setPhotos((current) => current.filter((k) => k !== key))}
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < 3 ? (
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border-strong text-content-subtle">
                {uploading ? <span className="type-micro">…</span> : <Icon name="camera" size={18} />}
                <span className="type-micro">Add</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file === undefined) return;
                    setPhotoError(null);
                    setUploading(true);
                    void uploadPhoto(file, photos.length).then((outcome) => {
                      setUploading(false);
                      if (outcome.ok) setPhotos((current) => [...current, outcome.key]);
                      else setPhotoError(outcome.message);
                    });
                  }}
                />
              </label>
            ) : null}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}

function ReopenSheet({
  complaint,
  onClose,
  onReopened,
}: {
  readonly complaint: ComplaintWire;
  readonly onClose: () => void;
  readonly onReopened: () => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    if (reason.trim().length < 10) {
      setFailed('Tell us what is still wrong — a line is enough.');
      return;
    }
    setPending(true);
    setFailed(null);
    const result = await simple<ComplaintWire>(`/api/complaints/${complaint.id}/reopen`, {
      method: 'POST',
      json: { complaintId: complaint.id, reason: reason.trim() },
    });
    setPending(false);
    if (result.ok) {
      onReopened();
      return;
    }
    setFailed(result.error.message);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Reopen this complaint"
      description="It marked fixed, but it came back. The committee sees it in their queue again."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Reopening" onClick={() => { void submit(); }}>
          Reopen
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Card padding="tight">
          <p className="type-label text-content-subtle">The complaint</p>
          <p className="type-body">{C.COMPLAINT_CATEGORY[complaint.category].label}</p>
          <p className="mt-1 type-label text-content-muted">{complaint.description}</p>
        </Card>

        <Field
          label="What is still wrong"
          required
          hint="Be specific — it goes to the committee as a note on the complaint."
        >
          <Textarea
            value={reason}
            rows={3}
            maxLength={1000}
            showCount
            invalid={failed !== null}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>

        {failed !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {failed}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
