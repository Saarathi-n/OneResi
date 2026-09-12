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
  Input,
  Money,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@oneresi/ui';
import { paise, rupees } from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The amenities register (UC-22): what exists, when it is open, what it costs an hour, and
 * whether residents can book it. Creating and editing are committee-only; retiring is a flag —
 * bookings in flight keep their records, the facility stops appearing to residents, and the
 * register keeps the history.
 */

interface ManagedFacility {
  id: number;
  name: string;
  description: string;
  opensAt: string;
  closesAt: string;
  hourlyRatePaise: number;
  active: boolean;
}

const CLOCK_TIMES: readonly { value: string; label: string }[] = Array.from(
  { length: 25 },
  (_, hour) => ({
    value: `${String(hour).padStart(2, '0')}:00`,
    label: `${String(hour).padStart(2, '0')}:00`,
  }),
);

const blankForm = {
  name: '',
  description: '',
  opensAt: '06:00',
  closesAt: '22:00',
  hourlyRupees: '150',
};

export default function FacilitiesManagePage() {
  const facilities = useFetch<readonly ManagedFacility[]>('/api/facilities/manage');
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ManagedFacility | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function create(): Promise<void> {
    const rupeesNumber = Number(form.hourlyRupees);
    if (!Number.isFinite(rupeesNumber) || rupeesNumber < 0) {
      setError('The hourly charge has to be a number.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await call<ManagedFacility>('/api/facilities/manage', {
      method: 'POST',
      json: {
        name: form.name,
        description: form.description,
        opensAt: form.opensAt,
        closesAt: form.closesAt,
        hourlyRatePaise: rupees(rupeesNumber),
      },
    });
    setPending(false);
    if (result.ok) {
      setCreating(false);
      setForm(blankForm);
      facilities.reload();
      toast.show({ title: `${result.data.name} added`, tone: 'positive' });
      return;
    }
    setError(result.error.message);
  }

  async function patch(facility: ManagedFacility, body: Record<string, unknown>, done: () => void, label: string): Promise<void> {
    const result = await call<ManagedFacility>(`/api/facilities/manage/${facility.id}`, {
      method: 'PATCH',
      json: { facilityId: facility.id, ...body },
    });
    if (result.ok) {
      done();
      facilities.reload();
      toast.show({ title: label, tone: 'positive' });
      return;
    }
    toast.show({ title: 'That change did not save', description: result.error.message, tone: 'critical' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-display text-content">Amenities</h1>
          <p className="type-body mt-1 text-content-muted">
            The society&apos;s bookable spaces — hours, hourly charge, and whether residents can
            book them at all.
          </p>
        </div>
        <Button onClick={() => { setCreating(true); setError(null); }}>Add a facility</Button>
      </div>

      {facilities.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={100} />
          <Skeleton variant="block" height={100} />
        </div>
      ) : facilities.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState title="The amenities did not load" onRetry={facilities.reload} />
          </CardBody>
        </Card>
      ) : facilities.state.data.length === 0 ? (
        <EmptyState
          title="No amenities yet"
          description="Add the clubhouse, the tennis court or the party hall — residents see whatever is active here."
        />
      ) : (
        <ul className="space-y-3">
          {facilities.state.data.map((facility) => (
            <li key={facility.id}>
              <Card elevation={1}>
                <CardHeader
                  title={facility.name}
                  subtitle={facility.description}
                  actions={
                    <Badge tone={facility.active ? 'positive' : 'neutral'} size="sm">
                      {facility.active ? 'Bookable' : 'Retired'}
                    </Badge>
                  }
                />
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="type-label text-content">
                      {facility.opensAt}–{facility.closesAt}
                    </span>
                    <span className="type-body text-content-muted">
                      <Money value={paise(facility.hourlyRatePaise)} label="hourly charge" /> an hour
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditing(facility);
                        setError(null);
                      }}
                    >
                      Edit
                    </Button>
                    {facility.active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void patch(facility, { active: false }, () => undefined, `${facility.name} retired`)}
                      >
                        Retire
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void patch(facility, { active: true }, () => undefined, `${facility.name} restored`)}
                      >
                        Restore
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a facility"
        description="Residents see it in the app the moment it is saved."
        pending={pending}
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Clubhouse" />
          </Field>
          <Field label="What it is" required hint="The line residents read under the name.">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="The hall on the ground floor, with tables and chairs for thirty."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opens" required>
              <Select
                options={CLOCK_TIMES}
                value={form.opensAt}
                onChange={(event) => update('opensAt', event.target.value)}
              />
            </Field>
            <Field label="Closes" required>
              <Select
                options={CLOCK_TIMES}
                value={form.closesAt}
                onChange={(event) => update('closesAt', event.target.value)}
              />
            </Field>
          </div>
          <Field label="Hourly charge (₹)" required hint="Charged per booked hour, snapshotted at booking time.">
            <Input
              inputMode="decimal"
              value={form.hourlyRupees}
              onChange={(event) => update('hourlyRupees', event.target.value)}
            />
          </Field>
          {error !== null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={pending}>
              Cancel
            </Button>
            <Button pending={pending} pendingLabel="Saving" onClick={() => void create()}>
              Add facility
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing !== null ? `Edit ${editing.name}` : 'Edit'}
        description="Hours always change together; a booking in flight keeps the charge it was made at."
      >
        {editing !== null ? <EditForm facility={editing} onSave={patch} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </div>
  );
}

function EditForm({
  facility,
  onSave,
  onDone,
}: {
  facility: ManagedFacility;
  onSave: (
    facility: ManagedFacility,
    body: Record<string, unknown>,
    done: () => void,
    label: string,
  ) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(facility.name);
  const [description, setDescription] = useState(facility.description);
  const [opensAt, setOpensAt] = useState(facility.opensAt);
  const [closesAt, setClosesAt] = useState(facility.closesAt);
  const [hourlyRupees, setHourlyRupees] = useState(String(facility.hourlyRatePaise / 100));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const rupeesNumber = Number(hourlyRupees);
    if (!Number.isFinite(rupeesNumber) || rupeesNumber < 0) {
      setError('The hourly charge has to be a number.');
      return;
    }
    setPending(true);
    setError(null);
    await onSave(
      facility,
      {
        name,
        description,
        opensAt,
        closesAt,
        hourlyRatePaise: rupees(rupeesNumber),
      },
      onDone,
      `${name} updated`,
    );
    setPending(false);
  }

  return (
    <div className="space-y-4">
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="What it is" required>
        <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opens" required>
          <Select options={CLOCK_TIMES} value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
        </Field>
        <Field label="Closes" required>
          <Select options={CLOCK_TIMES} value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
        </Field>
      </div>
      <Field label="Hourly charge (₹)" required>
        <Input inputMode="decimal" value={hourlyRupees} onChange={(event) => setHourlyRupees(event.target.value)} />
      </Field>
      {error !== null ? (
        <p className="type-body text-critical" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button pending={pending} pendingLabel="Saving" onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
