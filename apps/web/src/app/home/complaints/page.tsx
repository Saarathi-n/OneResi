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
  photoVerdict,
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

const CATEGORY_KEY = 'oneresi.complaint.category';

function loadLastCategory(): ComplaintCategory | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CATEGORY_KEY);
    if (raw !== null && (COMPLAINT_CATEGORIES as readonly string[]).includes(raw)) {
      return raw as ComplaintCategory;
    }
  } catch {
    // Remembering is a convenience, never a requirement.
  }
  return null;
}

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
  photoKeys: readonly string[];
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
  const [photos, setPhotos] = useState<readonly string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
  // that category first; failing that, the last kind this household reported. Both are offers —
  // never an overwrite of a choice the person already made.
  const categoryOffered = useRef(false);
  useEffect(() => {
    if (categoryOffered.current || category !== '') return;
    if (complaints.state.state !== 'ready') return;
    const open = complaints.state.data.find(
      (complaint) => complaint.status === 'OPEN' || complaint.status === 'IN_PROGRESS',
    );
    if (open !== undefined) {
      setCategory(open.category);
    } else {
      const last = loadLastCategory();
      if (last !== null) setCategory(last);
    }
    categoryOffered.current = true;
  }, [complaints.state, category]);

  // Uploads each chosen photo straight away, so a refusal names the one file and the form keeps
  // the rest. The count rides along so a fourth photo is refused before the complaint is raised.
  async function addPhotos(selected: FileList | readonly File[] | null): Promise<void> {
    if (selected === null) return;
    const files = Array.from(selected);
    if (files.length === 0) return;
    setPhotoError(null);
    setUploading(true);
    let attached = photos.length;
    for (const file of files) {
      const verdict = photoVerdict({
        type: file.type,
        sizeBytes: file.size,
        alreadyAttached: attached,
      });
      if (verdict !== null) {
        setPhotoError(verdict.message);
        break;
      }
      const body = new FormData();
      body.set('photo', file);
      body.set('already', String(attached));
      const result = await call<{ key: string }>('/api/complaints/photos/upload', {
        method: 'POST',
        body,
      });
      if (!result.ok) {
        setPhotoError(result.error.message);
        break;
      }
      attached += 1;
      setPhotos((current) => [...current, result.data.key]);
    }
    setUploading(false);
  }

  function createSamplePhotoBlob(): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgb(243, 244, 246)';
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = 'rgb(15, 118, 110)';
      ctx.fillRect(16, 16, 288, 208);
      ctx.fillStyle = 'rgb(255, 255, 255)';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Inspection Photo', 160, 105);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = 'rgb(204, 251, 241)';
      ctx.fillText('Resident Diagnostic Capture', 160, 135);
    }
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Sample photo creation failed'));
      }, 'image/png');
    });
  }

  async function attachSamplePhoto(): Promise<void> {
    if (photos.length >= 3) {
      setPhotoError('A complaint can carry at most 3 photos.');
      return;
    }
    try {
      const blob = await createSamplePhotoBlob();
      const file = new File([blob], `sample-${Date.now()}.png`, { type: 'image/png' });
      await addPhotos([file]);
    } catch {
      setPhotoError('Could not attach sample photo.');
    }
  }

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
      json: { category, priority, description: description.trim(), photoKeys: photos },
    });
    setPending(false);
    if (result.ok) {
      try {
        window.localStorage.setItem(CATEGORY_KEY, category);
      } catch {
        // Remembering is a convenience, never a requirement.
      }
      setDescription('');
      setCategory('');
      setPriority('MEDIUM');
      setPhotos([]);
      setPhotoError(null);
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
          <Field
            label="Photos"
            hint="Up to three. A leaking tap or water seepage says more in a picture."
            error={photoError ?? undefined}
          >
            <div className="space-y-4">
              {/* Image preview thumbnails when photos exist */}
              {photos.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photos.map((key, index) => (
                    <div
                      key={key}
                      className="group relative aspect-4/3 overflow-hidden rounded-xl border border-border bg-surface-sunken shadow-xs"
                    >
                      <img
                        src={`/api/complaints/photos/file?key=${encodeURIComponent(key)}`}
                        alt={`Attached photo ${index + 1}`}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
                      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 type-micro text-white backdrop-blur-xs font-medium">
                        Photo {index + 1}
                      </span>
                      <button
                        type="button"
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface-raised/90 text-content shadow-e1 hover:bg-critical hover:text-white transition-colors focus-ring"
                        aria-label={`Remove photo ${index + 1}`}
                        onClick={() => {
                          setPhotos((current) => current.filter((k) => k !== key));
                          setPhotoError(null);
                        }}
                      >
                        <span className="text-base font-semibold leading-none">×</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Prominent, clear, tactile dropzone */}
              {photos.length < 3 ? (
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    void addPhotos(event.dataTransfer.files);
                  }}
                  className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                    isDragging
                      ? 'border-accent bg-accent-soft/40 ring-2 ring-accent/30'
                      : 'border-border-strong/70 bg-surface-raised hover:border-accent hover:bg-surface-sunken/40'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-content-subtle group-hover:bg-accent-soft group-hover:text-accent transition-colors">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>

                  <p className="type-body font-medium text-content mt-3">
                    <label className="cursor-pointer text-accent hover:underline focus-within:underline">
                      <span>Click to upload</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="sr-only"
                        onChange={(event) => {
                          const files = event.target.files;
                          event.target.value = '';
                          void addPhotos(files);
                        }}
                      />
                    </label>{' '}
                    <span className="text-content-muted">or drag and drop</span>
                  </p>

                  <p className="type-micro text-content-subtle mt-1">
                    JPEG, PNG or WebP up to 5 MB ({3 - photos.length} {3 - photos.length === 1 ? 'photo slot' : 'photo slots'} remaining)
                  </p>
                </div>
              ) : null}

              {/* Action helper bar: "Attach sample photo" helper button */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  disabled={uploading || photos.length >= 3}
                  onClick={() => void attachSamplePhoto()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3.5 py-1.5 type-label font-medium text-content hover:bg-surface-sunken hover:border-border-strong disabled:opacity-50 transition-colors focus-ring"
                >
                  <span className="text-accent font-bold leading-none">+</span>
                  <span>{uploading ? 'Attaching…' : 'Attach sample photo'}</span>
                </button>

                {photos.length > 0 && (
                  <span className="type-micro text-content-subtle">
                    {photos.length} of 3 photos attached
                  </span>
                )}
              </div>
            </div>
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

                  {complaint.photoKeys.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
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
