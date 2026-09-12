'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  useToast,
} from '@oneresi/ui';
import { authHeaders } from '@/lib/session';

/**
 * The committee's exports (UC-27): one of three reports, for a date range, as a CSV the
 * spreadsheet opens directly. The route streams the file with a download disposition — this
 * screen only chooses the kind and the range, and the empty-range case is the file itself
 * arriving with headers only, stated in the toast rather than refused.
 */

const KINDS = [
  { value: 'dues', label: 'Dues — every invoice with its status' },
  { value: 'complaints', label: 'Complaints — the whole queue with history counts' },
  { value: 'visitors', label: 'Visitors — the gate log, entries and exits' },
] as const;

const today = (): string => new Date().toISOString().slice(0, 10);
const aMonthAgo = (): string =>
  new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export default function ReportsPage() {
  const toast = useToast();
  const [kind, setKind] = useState<string>('dues');
  const [from, setFrom] = useState(aMonthAgo);
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function download(): Promise<void> {
    if (from > to) {
      setError('The end of the range cannot be before its start.');
      return;
    }
    setPending(true);
    setError(null);

    // The session's call() parses JSON; a CSV needs the raw response, so this fetch carries the
    // same headers the session layer would set. A 401 here is the same event it is anywhere
    // else — the sign-in page takes over.
    const response = await fetch(
      `/api/reports?kind=${encodeURIComponent(kind)}&from=${from}&to=${to}`,
      {
        headers: authHeaders() ?? {},
        credentials: 'include',
      },
    );
    setPending(false);

    if (response.status === 401) {
      window.location.href = '/sign-in';
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'The report could not be generated.');
      return;
    }

    const empty = response.headers.get('x-report-empty') === '1';
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = named?.[1] ?? 'report.csv';
    anchor.click();
    URL.revokeObjectURL(url);

    toast.show({
      title: empty ? 'The range was empty' : 'Report downloaded',
      description: empty
        ? 'The file has only its header row — no records fall inside that range.'
        : named?.[1] ?? 'report.csv',
      tone: empty ? 'neutral' : 'positive',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Reports</h1>
        <p className="type-body mt-1 text-content-muted">
          Dues, complaints and the gate log, as a spreadsheet file for any date range.
        </p>
      </div>

      <Card elevation={1}>
        <CardHeader title="Export a report" subtitle="CSV, one row per record, end date included." />
        <CardBody className="space-y-4">
          <Field label="Report" required>
            <Select
              options={KINDS.map((option) => ({ value: option.value, label: option.label }))}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" required>
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To" required hint="The end date is included.">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          {error !== null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <Button pending={pending} pendingLabel="Generating" onClick={() => void download()}>
              Download CSV
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
