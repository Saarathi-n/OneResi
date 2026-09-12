'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeDisplay,
  EmptyState,
  ErrorState,
  Field,
  Input,
  RelativeTime,
  Select,
  Skeleton,
  StatusPill,
  useToast,
} from '@oneresi/ui';
import { APPROVAL_STATUS, PASS_STATUS, formatCalendarDate } from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch, type FetchState } from '@/lib/useFetch';

/**
 * Visitors: the household's whole gate life. Issue a pass pre-filled from the household's own
 * history (the last three names, the most-used purpose), answer the gate from the waiting list,
 * and read the log of who actually came.
 */

const PASSES_PATH = '/api/visitors/passes';
const ENTRIES_PATH = '/api/visitors/entries';

const DEFAULT_PURPOSES = ['Delivery', 'Cab', 'Guest', 'Domestic help', 'Service visit'];

interface PassLine {
  id: number;
  visitorName: string;
  purpose: string;
  code: string;
  validOn: string;
  status: keyof typeof PASS_STATUS;
  arrivedAt: string | null;
}

interface EntryLine {
  logId: number;
  kind: 'PASS' | 'WALK_IN';
  visitorName: string;
  purpose: string;
  approvalStatus: keyof typeof APPROVAL_STATUS;
  decidedByName: string | null;
  overrideReason: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  at: string;
}

interface WaitingVisitor {
  logId: number;
  name: string;
  phone: string | null;
  purpose: string;
  since: string;
}

export default function VisitorsPage() {
  const passes = useFetch<readonly PassLine[]>(PASSES_PATH);
  const entries = useFetch<readonly EntryLine[]>(ENTRIES_PATH);
  const toast = useToast();

  // Pre-fill: the last three names the household issued passes for, and the purpose used most.
  const [names, setNames] = useState<string[]>([]);
  const [purposes, setPurposes] = useState<string[]>(DEFAULT_PURPOSES);
  useEffect(() => {
    if (passes.state.state !== 'ready') return;
    const seen: string[] = [];
    for (const pass of passes.state.data) {
      if (!seen.includes(pass.visitorName)) seen.push(pass.visitorName);
    }
    setNames(seen.slice(0, 3));
    const counts = new Map<string, number>();
    for (const pass of passes.state.data) {
      counts.set(pass.purpose, (counts.get(pass.purpose) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([purpose]) => purpose);
    const merged = [...new Set([...ranked, ...DEFAULT_PURPOSES])];
    setPurposes(merged.slice(0, 8));
  }, [passes.state]);

  const [visitorName, setVisitorName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [customPurpose, setCustomPurpose] = useState('');
  const [validOn, setValidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [nameError, setNameError] = useState<string | null>(null);
  const [purposeError, setPurposeError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<PassLine | null>(null);

  const waiting = useWaitingList(entries.reload);

  const finalPurpose = purpose === '__other' ? customPurpose.trim() : purpose;

  const purposeOptions = useMemo(
    () => [
      ...purposes.map((value) => ({ value, label: value })),
      { value: '__other', label: 'Something else' },
    ],
    [purposes],
  );

  async function submitPass(): Promise<void> {
    setNameError(null);
    setPurposeError(null);
    setFormError(null);
    if (visitorName.trim().length < 2) {
      setNameError('Enter the visitor’s full name.');
      return;
    }
    if (finalPurpose.length < 2) {
      setPurposeError('Choose what they are coming for, or type it in.');
      return;
    }
    setPending(true);
    const result = await call<PassLine>('/api/visitors/passes', {
      method: 'POST',
      json: {
        visitorName: visitorName.trim(),
        purpose: finalPurpose,
        validDate: validOn,
      },
    });
    setPending(false);
    if (result.ok) {
      setIssued(result.data);
      setVisitorName('');
      passes.reload();
      return;
    }
    setFormError(result.error.message);
    if (result.error.field === 'visitorName') setNameError(result.error.message);
    if (result.error.field === 'purpose') setPurposeError(result.error.message);
  }

  async function cancelPass(pass: PassLine): Promise<void> {
    setCancellingId(pass.id);
    const result = await call<PassLine>(`/api/visitors/passes/${pass.id}/cancel`, {
      method: 'POST',
      json: { passId: pass.id },
    });
    setCancellingId(null);
    if (result.ok) {
      passes.reload();
      toast.show({
        title: 'Pass cancelled',
        description: `${pass.visitorName} will be turned away at the gate.`,
      });
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="type-title text-content">Visitors</h1>

      {/* The waiting list first: it is the thing with a clock on it. */}
      {waiting.state === 'ready' && waiting.data.length > 0 ? (
        <WaitingPanel waiting={waiting.data} onChanged={entries.reload} />
      ) : null}

      {issued !== null ? (
        <Card elevation={1} className="border-strong">
          <CardHeader title="Pass issued" subtitle="Read the code to your visitor, or send it to them." />
          <CardBody className="space-y-3">
            <CodeDisplay code={issued.code} label={`Pass code for ${issued.visitorName}`} copyable />
            <p className="type-body text-content-muted">
              {issued.visitorName} · {issued.purpose} · valid{' '}
              {formatCalendarDate(issued.validOn)}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setIssued(null)}>
              Issue another
            </Button>
          </CardBody>
        </Card>
      ) : (
        <Card elevation={0} className="border border-border">
          <CardHeader title="Issue a visitor pass" subtitle="The gate will know them by the code." />
          <CardBody className="space-y-5">
            {names.length > 0 ? (
              <div>
                <p className="type-label text-content-subtle">Recent visitors</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {names.map((name) => (
                    <Button
                      key={name}
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => {
                        setVisitorName(name);
                        setNameError(null);
                      }}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <Field label="Visitor's name" required error={nameError}>
              <Input
                value={visitorName}
                autoComplete="off"
                onBlur={() => {
                  if (visitorName.trim().length < 2) setNameError('Enter the visitor’s full name.');
                  else setNameError(null);
                }}
                onChange={(event) => setVisitorName(event.target.value)}
              />
            </Field>

            <Field label="Coming for" required error={purposeError}>
              <Select
                options={purposeOptions}
                placeholder="Choose a purpose"
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  setPurposeError(null);
                }}
              />
            </Field>
            {purpose === '__other' ? (
              <Field label="Describe the purpose" required error={purposeError}>
                <Input
                  value={customPurpose}
                  onChange={(event) => setCustomPurpose(event.target.value)}
                />
              </Field>
            ) : null}

            <Field label="Valid on" required hint="Passes work on one day only.">
              <Input
                type="date"
                value={validOn}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setValidOn(event.target.value)}
              />
            </Field>

            {formError !== null ? (
              <p className="type-body text-critical" role="alert">
                {formError}
              </p>
            ) : null}

            <Button
              pending={pending}
              pendingLabel="Issuing the pass"
              onClick={() => void submitPass()}
            >
              Issue pass
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Active and recent passes. */}
      <div>
        <h2 className="type-title text-content">Your passes</h2>
        {passes.state.state === 'loading' ? (
          <div className="mt-3 space-y-3">
            <Skeleton variant="block" height={64} />
            <Skeleton variant="block" height={64} />
          </div>
        ) : passes.state.state === 'failed' ? (
          <div className="mt-3">
            <ErrorState title="Your passes did not load" onRetry={passes.reload} />
          </div>
        ) : passes.state.data.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              size="compact"
              title="No passes yet"
              description="Issue the first one above — the gate reads the code and admits your visitor."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {passes.state.data.map((pass) => (
              <Card key={pass.id} elevation={0} className="border border-border">
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="type-body truncate text-content">{pass.visitorName}</p>
                      <StatusPill descriptor={PASS_STATUS[pass.status]} size="sm" />
                    </div>
                    <p className="type-micro mt-1 text-content-subtle">
                      {pass.purpose} · valid{' '}
                      {formatCalendarDate(pass.validOn)}{' '}
                      · code {pass.code}
                    </p>
                  </div>
                  {pass.status === 'ACTIVE' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      pending={cancellingId === pass.id}
                      pendingLabel="Cancelling"
                      onClick={() => void cancelPass(pass)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </ul>
        )}
      </div>

      {/* The log. */}
      <div>
        <h2 className="type-title text-content">Your door, today and before</h2>
        {entries.state.state === 'loading' ? (
          <div className="mt-3 space-y-3">
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="55%" />
          </div>
        ) : entries.state.state === 'failed' ? (
          <div className="mt-3">
            <ErrorState title="Your visitor log did not load" onRetry={entries.reload} />
          </div>
        ) : entries.state.data.length === 0 ? (
          <p className="type-body mt-3 text-content-muted">
            Nobody has come calling yet. A pass or a walk-in logged at the gate will show up here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface-raised">
            {entries.state.data.map((entry) => (
              <li key={entry.logId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="type-body truncate text-content">
                    {entry.visitorName} · {entry.purpose}
                  </p>
                  <p className="type-micro text-content-subtle">
                    {entry.kind === 'PASS' ? 'On a pass' : 'Walk-in'} ·{' '}
                    <RelativeTime value={entry.at} />
                    {entry.overrideReason !== null ? ' · guard let them in directly' : ''}
                  </p>
                </div>
                <StatusPill descriptor={APPROVAL_STATUS[entry.approvalStatus]} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The waiting list, kept current by the live stream with the fetch as the first paint. */
function useWaitingList(onChanged: () => void): FetchState<readonly WaitingVisitor[]> {
  const [state, setState] = useState<FetchState<readonly WaitingVisitor[]>>({ state: 'loading' });
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    void (async () => {
      const result = await call<readonly WaitingVisitor[]>('/api/visitors/waiting');
      setState(result.ok ? { state: 'ready', data: result.data } : { state: 'failed', error: result.error });
    })();

    const source = new EventSource('/api/gate/live', { withCredentials: true });
    source.addEventListener('waiting', (event) => {
      try {
        const frame: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!Array.isArray(frame)) return;
        setState({ state: 'ready', data: frame as readonly WaitingVisitor[] });
        changed.current();
      } catch {
        // A malformed frame does not clear a good list.
      }
    });
    source.addEventListener('error', () => {
      // The stream dying does not un-know who is at the gate; the fetch state stands.
    });
    return () => {
      source.close();
    };
  }, []);

  return state;
}

function WaitingPanel({
  waiting,
  onChanged,
}: {
  waiting: readonly WaitingVisitor[];
  onChanged: () => void;
}) {
  const [busyLogId, setBusyLogId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(logId: number, decision: 'ADMIT' | 'REJECT'): Promise<void> {
    setBusyLogId(logId);
    setError(null);
    const result = await call<null>(`/api/visitors/walk-ins/${logId}/decision`, {
      method: 'POST',
      json: { logId, decision },
    });
    setBusyLogId(null);
    if (result.ok) {
      onChanged();
      return;
    }
    setError(result.error.message);
  }

  return (
    <Card elevation={2} className="border-strong">
      <CardHeader
        title={`${waiting.length} at the gate for you`}
        subtitle="The guard is waiting on your answer."
        actions={<Badge tone="caution" size="sm">Now</Badge>}
      />
      <CardBody className="space-y-4">
        {error !== null ? (
          <p className="type-body text-critical" role="alert">
            {error}
          </p>
        ) : null}
        {waiting.map((visitor) => (
          <div
            key={visitor.logId}
            className="flex items-center justify-between gap-4 rounded-xl bg-accent-soft p-4"
          >
            <div className="min-w-0">
              <p className="type-body truncate text-content">
                {visitor.name} · {visitor.purpose}
              </p>
              <p className="type-micro mt-1 text-content-muted">
                <RelativeTime value={visitor.since} />
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                pending={busyLogId === visitor.logId}
                pendingLabel="Recording your answer"
                onClick={() => void decide(visitor.logId, 'ADMIT')}
              >
                Admit
              </Button>
              <Button
                size="sm"
                variant="danger"
                pending={busyLogId === visitor.logId}
                pendingLabel="Recording your answer"
                onClick={() => void decide(visitor.logId, 'REJECT')}
              >
                Turn away
              </Button>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
