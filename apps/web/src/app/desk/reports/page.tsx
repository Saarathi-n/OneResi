'use client';

import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  useToast,
  cn,
} from '@oneresi/ui';
import { formatCalendarDate, istDayString } from '@oneresi/contracts';
import { authHeaders } from '@/lib/session';

/**
 * The committee's exports: one of three reports, for a date range, as a CSV spreadsheet
 * file. Upgraded paper-styled container cards present kind selection, preset ranges, and
 * date inputs, with an instant file preview summary before downloading.
 */

const KINDS = [
  {
    value: 'dues',
    name: 'Dues & Collections',
    badge: 'Ledger',
    description: 'Every invoice with its status — amount, due date and receipt.',
    source: 'One row for every invoice whose due date falls inside the range.',
  },
  {
    value: 'complaints',
    name: 'Complaints Queue',
    badge: 'Tickets',
    description: 'The whole queue — category, priority, history counts.',
    source: 'One row for every complaint raised inside the range.',
  },
  {
    value: 'visitors',
    name: 'Visitor Log',
    badge: 'Gate Log',
    description: 'The gate log — entries and exits, visitor by visitor.',
    source: 'One row for every gate log entry created inside the range.',
  },
] as const;

type Kind = (typeof KINDS)[number]['value'];

const PRESETS = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-30-days', label: 'Last 30 days' },
  { id: 'this-quarter', label: 'This quarter' },
  { id: 'financial-year', label: 'This financial year' },
] as const;

type Preset = (typeof PRESETS)[number]['id'];

const PREVIEW_COLUMNS: Record<Kind, readonly { header: string; sample: string }[]> = {
  dues: [
    { header: 'Unit', sample: 'Tower A - 302' },
    { header: 'Resident', sample: 'Rajesh Sharma' },
    { header: 'Amount', sample: '₹4,500' },
    { header: 'Due Date', sample: '15 Sep 2026' },
    { header: 'Status', sample: 'PAID' },
    { header: 'Receipt', sample: 'REC-2026-0042' },
  ],
  complaints: [
    { header: 'Ticket ID', sample: '#104' },
    { header: 'Unit', sample: 'Tower B - 104' },
    { header: 'Category', sample: 'Plumbing' },
    { header: 'Priority', sample: 'High' },
    { header: 'Status', sample: 'RESOLVED' },
    { header: 'Raised Date', sample: '02 Sep 2026' },
  ],
  visitors: [
    { header: 'Pass Code', sample: '849 201' },
    { header: 'Unit', sample: 'Tower A - 101' },
    { header: 'Visitor', sample: 'Aarav Patel' },
    { header: 'Purpose', sample: 'Delivery' },
    { header: 'Entry Time', sample: '10:45 AM' },
    { header: 'Exit Time', sample: '11:15 AM' },
  ],
};

/** `YYYY-MM-DD` shifted by whole days, in the calendar the day strings are written in. */
function shiftDay(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The range a preset stands for, read on the IST clock the society runs on. */
function presetRange(preset: Preset, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const thisMonthStart = `${today.slice(0, 4)}-${today.slice(5, 7)}-01`;
  switch (preset) {
    case 'this-month':
      return { from: thisMonthStart, to: today };
    case 'last-month': {
      const lastOfPrevious = shiftDay(thisMonthStart, -1);
      return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious };
    }
    case 'last-30-days':
      return { from: shiftDay(today, -29), to: today };
    case 'this-quarter': {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`, to: today };
    }
    case 'financial-year': {
      // The Indian financial year runs April to March.
      const fyStartYear = month >= 4 ? year : year - 1;
      return { from: `${fyStartYear}-04-01`, to: today };
    }
  }
}

export default function ReportsPage(): ReactNode {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('dues');
  const [preset, setPreset] = useState<Preset | null>('last-30-days');
  const [from, setFrom] = useState<string>(() => presetRange('last-30-days', istDayString()).from);
  const [to, setTo] = useState<string>(() => istDayString());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selected = KINDS.find((option) => option.value === kind) ?? KINDS[0];
  const expectedFilename = `${selected.value}-${from || 'start'}-to-${to || 'end'}.csv`;

  function applyPreset(id: Preset): void {
    const range = presetRange(id, istDayString());
    setPreset(id);
    setFrom(range.from);
    setTo(range.to);
    setError(null);
  }

  function editFrom(value: string): void {
    setFrom(value);
    setPreset(null);
  }

  function editTo(value: string): void {
    setTo(value);
    setPreset(null);
  }

  async function download(): Promise<void> {
    if (from === '' || to === '') {
      setError('Choose both ends of the range.');
      return;
    }
    if (from > to) {
      setError('The end of the range cannot be before its start.');
      return;
    }
    setPending(true);
    setError(null);

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
    anchor.download = named?.[1] ?? expectedFilename;
    anchor.click();
    URL.revokeObjectURL(url);

    toast.show({
      title: empty ? 'The range was empty' : 'Report downloaded',
      description: empty
        ? 'The file has only its header row — no records fall inside that range.'
        : (named?.[1] ?? expectedFilename),
      tone: empty ? 'neutral' : 'positive',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Reports & Exports</h1>
        <p className="type-body mt-1 text-content-muted">
          Dues, complaints and the gate log, as a spreadsheet file for any date range.
        </p>
      </div>

      <div className="space-y-6">
        {/* Step 1: Report Kind Selector in Paper Container Cards */}
        <Card elevation={1}>
          <CardHeader
            title="1. Select report kind"
            subtitle="Choose the operational domain for this export"
          />
          <CardBody>
            <div className="grid gap-3.5 sm:grid-cols-3" role="radiogroup" aria-label="Report kind">
              {KINDS.map((option) => {
                const isSelected = kind === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'relative flex cursor-pointer flex-col justify-between rounded-2xl border p-4.5 transition-all',
                      isSelected
                        ? 'border-accent bg-accent-soft/30 shadow-xs ring-1 ring-accent edge-light'
                        : 'border-border bg-surface-raised hover:border-border-strong hover:bg-surface-sunken/40',
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex h-4 w-4 items-center justify-center rounded-full border transition-colors',
                              isSelected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
                            )}
                            aria-hidden
                          >
                            {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-accent-on" />}
                          </span>
                          <span className="type-title font-semibold text-content">{option.name}</span>
                        </div>
                        <Badge tone={isSelected ? 'info' : 'neutral'} size="sm">
                          {option.badge}
                        </Badge>
                      </div>
                      <p className="type-label mt-2 text-content-muted">{option.description}</p>
                    </div>

                    <p className="type-micro mt-3 border-t border-border/60 pt-2 text-content-subtle">
                      {option.source}
                    </p>

                    <input
                      type="radio"
                      name="report-kind"
                      value={option.value}
                      checked={isSelected}
                      onChange={() => setKind(option.value)}
                      className="sr-only"
                    />
                  </label>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Step 2: Date Range & Preset Pills Container Card */}
        <Card elevation={1}>
          <CardHeader
            title="2. Date range & presets"
            subtitle="Pick a standard reporting period or enter custom calendar boundaries"
          />
          <CardBody className="space-y-4">
            <div className="space-y-1.5">
              <span className="type-label font-medium text-content">Preset periods</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Preset periods">
                {PRESETS.map((option) => {
                  const isSelected = preset === option.id;
                  return (
                    <Button
                      key={option.id}
                      size="sm"
                      variant={isSelected ? 'primary' : 'ghost'}
                      className={cn(
                        isSelected
                          ? 'shadow-xs font-semibold'
                          : 'bg-surface-sunken text-content-muted hover:text-content hover:bg-surface-sunken/80 border border-border/80',
                      )}
                      onClick={() => applyPreset(option.id)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-border/60">
              <Field label="From date" required hint="Inclusive start of period">
                <Input
                  type="date"
                  value={from}
                  onChange={(event) => editFrom(event.target.value)}
                  className="bg-surface"
                />
              </Field>
              <Field label="To date" required hint="The end date is included in the export">
                <Input
                  type="date"
                  value={to}
                  onChange={(event) => editTo(event.target.value)}
                  className="bg-surface"
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        {/* Step 3: File Preview & Download Summary Container Card */}
        <Card elevation={1}>
          <CardHeader
            title="3. File preview & export summary"
            subtitle="Verify file details and column structure before generating"
          />
          <CardBody className="space-y-4">
            {/* Summary Banner */}
            <div className="rounded-2xl border border-border bg-surface-sunken/60 p-4 space-y-2 edge-light">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="type-label font-semibold text-content">{selected.name}</span>
                  <span className="type-micro text-content-subtle">·</span>
                  <span className="type-label text-content-muted">
                    {from ? formatCalendarDate(from) : 'Start'} to {to ? formatCalendarDate(to) : 'End'} (inclusive)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral" size="sm">
                    CSV Format
                  </Badge>
                  <span className="type-micro rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-content-subtle">
                    {expectedFilename}
                  </span>
                </div>
              </div>
              <p className="type-micro text-content-subtle">{selected.source}</p>
            </div>

            {/* Column Structure Preview */}
            <div className="space-y-2">
              <span className="type-label font-medium text-content">Exported column structure</span>
              <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                <table className="w-full text-left type-label">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken/40">
                      {PREVIEW_COLUMNS[kind].map((col) => (
                        <th key={col.header} className="px-3.5 py-2.5 font-semibold text-content">
                          {col.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {PREVIEW_COLUMNS[kind].map((col) => (
                        <td key={col.header} className="px-3.5 py-2.5 font-mono type-micro text-content-muted">
                          {col.sample}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {error !== null ? (
              <div
                className="rounded-xl border border-critical-border bg-critical-soft p-3 text-critical type-body"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            {/* Actions & Download Button */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border">
              <p className="type-micro text-content-subtle">
                UTF-8 encoded · Direct spreadsheet compatibility
              </p>
              <Button
                size="md"
                pending={pending}
                pendingLabel="Generating file"
                onClick={() => void download()}
              >
                Download CSV
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
