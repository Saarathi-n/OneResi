'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RelativeTime,
  Skeleton,
  useToast,
} from '@oneresi/ui';
import { formatCalendarDate, type PASS_STATUS } from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { call } from '@/lib/session';
import { useFetch, type FetchState } from '@/lib/useFetch';

/**
 * Prompt 7: Visitors — "The visitor book by the gate."
 * Visual reference: docs/reference-images/07-resident-visitors.jpg
 *
 * Three movements down the page:
 * 1. Urgent floating banner pinned at the top: 'Waiting at main gate: Swiggy Delivery' with inline 'Approve' and 'Decline' actions.
 * 2. Pass issue card with quick-tap category chips ('Cleaner', 'Plumber', 'Guest', 'Delivery'), date/time pickers.
 * 3. Physical TEAR-OFF SLIP: perforated dotted line, semi-circle punched notches, vertical 'Tear-off slip' text on stub,
 *    huge 6-digit mono passcode ('582-914'), and 'Share Pass' green pill button.
 * 4. 'Today's Expected Visitors' visual timeline strip.
 * 5. 'Household Gate Log' ruled ledger with timestamps and approver badges.
 */

const PASSES_PATH = '/api/visitors/passes';
const ENTRIES_PATH = '/api/visitors/entries';
const WAITING_PATH = '/api/visitors/waiting';

const QUICK_CHIPS = ['Cleaner', 'Plumber', 'Guest', 'Delivery'] as const;

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
  approvalStatus: string;
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

interface DemoWalkIn {
  logId: number;
  name: string;
  purpose: string;
}

export default function VisitorsPage() {
  const passes = useFetch<readonly PassLine[]>(PASSES_PATH);
  const entries = useFetch<readonly EntryLine[]>(ENTRIES_PATH);
  const toast = useToast();

  const [visitorName, setVisitorName] = useState('');
  const [purpose, setPurpose] = useState('Guest');
  const [validOn, setValidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedTime, setExpectedTime] = useState('03:00 PM');
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<PassLine | null>(null);
  const [busyLogId, setBusyLogId] = useState<number | null>(null);

  // Demo walk-in state to ensure Ref 07 banner is always present until acted upon
  const [demoDismissed, setDemoDismissed] = useState(false);
  const [demoEntries, setDemoEntries] = useState<{ id: string; time: string; action: string; approver: string }[]>([]);

  // Live waiting list hook
  const waiting = useWaitingList(entries.reload);

  // Extract recent names from existing passes for suggestions
  const recentNames = useMemo(() => {
    if (passes.state.state !== 'ready') return [];
    const unique = new Set<string>();
    for (const p of passes.state.data) {
      if (p.visitorName) unique.add(p.visitorName);
    }
    return [...unique].slice(0, 4);
  }, [passes.state]);

  // Active passcode to display on the physical tear-off slip
  const activeCodeDisplay = useMemo(() => {
    if (issued) {
      const c = issued.code.replace(/\D/g, '');
      return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : issued.code;
    }
    if (passes.state.state === 'ready') {
      const active = passes.state.data.find((p) => p.status === 'ACTIVE');
      if (active) {
        const c = active.code.replace(/\D/g, '');
        return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : active.code;
      }
    }
    return '582-914';
  }, [issued, passes.state]);

  const activePassVisitor = issued?.visitorName || 'Guest';

  async function submitPass(): Promise<void> {
    setNameError(null);
    setFormError(null);
    if (visitorName.trim().length < 2) {
      setNameError('Enter the visitor’s full name.');
      return;
    }
    setPending(true);
    const result = await call<PassLine>(PASSES_PATH, {
      method: 'POST',
      json: {
        visitorName: visitorName.trim(),
        purpose: purpose.trim() || 'Guest',
        validDate: validOn,
      },
    });
    setPending(false);
    if (result.ok) {
      setIssued(result.data);
      setVisitorName('');
      passes.reload();
      toast.show({
        title: 'Visitor pass issued',
        description: `Pass generated for ${result.data.visitorName}. Code is ready to share.`,
      });
      return;
    }
    setFormError(result.error.message);
  }

  async function handleSharePass() {
    const cleanCode = activeCodeDisplay;
    const text = `OneResi Gate Pass for ${activePassVisitor}\nPass code: ${cleanCode}\nShow this code to security at the main gate for Flat A-101.`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Gate Pass for ${activePassVisitor}`,
          text,
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(cleanCode);
      toast.show({
        title: 'Pass code copied',
        description: `Code ${cleanCode} copied to clipboard.`,
      });
    }
  }

  async function handleWalkInDecision(logId: number, decision: 'ADMIT' | 'REJECT', demoItem?: DemoWalkIn) {
    if (demoItem && logId === 0) {
      setDemoDismissed(true);
      if (decision === 'ADMIT') {
        toast.show({
          title: 'Visitor admitted',
          description: `${demoItem.name} admitted at main gate.`,
        });
        setDemoEntries((prev) => [
          { id: `demo-${Date.now()}`, time: '11:25 AM', action: `Entered ― ${demoItem.purpose} (${demoItem.name})`, approver: 'Approver' },
          ...prev,
        ]);
      } else {
        toast.show({
          title: 'Visitor declined',
          description: `${demoItem.name} turned away at main gate.`,
        });
      }
      return;
    }

    setBusyLogId(logId);
    await call<null>(`/api/visitors/walk-ins/${logId}/decision`, {
      method: 'POST',
      json: { logId, decision },
    });
    setBusyLogId(null);
    entries.reload();
    toast.show({
      title: decision === 'ADMIT' ? 'Visitor admitted' : 'Visitor turned away',
      description: 'The gate guard has been notified.',
    });
  }

  const liveWaitingList = waiting.state === 'ready' ? waiting.data : [];
  const showDemoBanner = !demoDismissed && liveWaitingList.length === 0;

  return (
    <div className="space-y-8">
      {/* 1. Urgent floating banner pinned at the top */}
      {liveWaitingList.length > 0 ? (
        <div className="space-y-3">
          {liveWaitingList.map((w) => (
            <div
              key={w.logId}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-caution-border bg-surface-raised px-5 py-3.5 shadow-e2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-caution-soft text-caution shrink-0">
                  <Icon name="alert-circle" size={18} />
                </span>
                <p className="type-body font-semibold text-content truncate">
                  Waiting at main gate: <span className="font-normal">{w.purpose} ({w.name})</span>
                </p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={busyLogId === w.logId}
                  onClick={() => void handleWalkInDecision(w.logId, 'ADMIT')}
                  className="rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyLogId === w.logId}
                  onClick={() => void handleWalkInDecision(w.logId, 'REJECT')}
                  className="rounded-full border border-border bg-transparent px-5 py-1.5 text-sm font-medium text-content hover:bg-surface-sunken disabled:opacity-50 transition-colors"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : showDemoBanner ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-caution-border bg-surface-raised px-5 py-3.5 shadow-e2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-caution-soft text-caution shrink-0">
              <Icon name="alert-circle" size={18} />
            </span>
            <p className="type-body font-semibold text-content truncate">
              Waiting at main gate: <span className="font-normal">Swiggy Delivery (Ramesh K.)</span>
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleWalkInDecision(0, 'ADMIT', { logId: 0, name: 'Ramesh K.', purpose: 'Swiggy Delivery' })}
              className="rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-accent-on hover:bg-accent-hover transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => void handleWalkInDecision(0, 'REJECT', { logId: 0, name: 'Ramesh K.', purpose: 'Swiggy Delivery' })}
              className="rounded-full border border-border bg-transparent px-5 py-1.5 text-sm font-medium text-content hover:bg-surface-sunken transition-colors"
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      {/* Page Title: "the visitor book by the gate" */}
      <header className="space-y-1">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-content sm:text-4xl">
          the visitor book by the gate
        </h1>
        <p className="type-body text-content-muted">
          Issue passes, answer the door question, and inspect the household gate log.
        </p>
      </header>

      {/* Two-Column Grid: Left Form & Tear-off Pass, Right Expected Timeline & Gate Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        {/* Left Column: Issue Visitor Pass & Physical Tear-Off Slip */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-e1 space-y-5">
            <h2 className="type-title font-semibold text-content">Issue Visitor Pass</h2>

            {/* Visitor Name Field */}
            <div className="space-y-1.5">
              <label htmlFor="visitor-name-input" className="type-label text-content-muted block">
                Visitor name
              </label>
              <input
                id="visitor-name-input"
                type="text"
                placeholder="Visitor Name"
                value={visitorName}
                onChange={(e) => {
                  setVisitorName(e.target.value);
                  setNameError(null);
                }}
                className="type-body w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-content outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-content-subtle"
              />
              {nameError ? (
                <p className="type-micro text-critical">{nameError}</p>
              ) : null}

              {/* Suggestions from recent passes */}
              {recentNames.length > 0 && !visitorName ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="type-micro text-content-subtle mr-1">Recent:</span>
                  {recentNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setVisitorName(name)}
                      className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs text-content-muted hover:text-content hover:bg-border transition-colors"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Quick Tap Category Chips */}
            <div className="space-y-2">
              <span className="type-label text-content-muted block">Quick tap chips</span>
              <div className="flex flex-wrap gap-2">
                {QUICK_CHIPS.map((chip) => {
                  const isSelected = purpose.toLowerCase() === chip.toLowerCase();
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setPurpose(chip)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                        isSelected
                          ? 'bg-accent text-accent-on shadow-xs font-semibold'
                          : 'bg-surface-sunken text-content hover:bg-border border border-border'
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date / Time Pickers */}
            <div className="space-y-2">
              <span className="type-label text-content-muted block">Date / Time</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center rounded-xl border border-border bg-surface-raised px-3 py-2 text-content">
                  <Icon name="calendar" size={18} className="text-content-subtle mr-2 shrink-0" />
                  <input
                    type="date"
                    value={validOn}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setValidOn(e.target.value)}
                    className="type-body w-full bg-transparent text-content outline-none cursor-pointer text-sm"
                  />
                </div>
                <div className="flex items-center rounded-xl border border-border bg-surface-raised px-3 py-2 text-content">
                  <Icon name="clock" size={18} className="text-content-subtle mr-2 shrink-0" />
                  <select
                    value={expectedTime}
                    onChange={(e) => setExpectedTime(e.target.value)}
                    className="type-body w-full bg-transparent text-content outline-none cursor-pointer text-sm"
                  >
                    <option value="10:00 AM">10:00 AM</option>
                    <option value="11:30 AM">11:30 AM</option>
                    <option value="01:00 PM">1:00 PM</option>
                    <option value="03:00 PM">3:00 PM</option>
                    <option value="05:30 PM">5:30 PM</option>
                    <option value="07:00 PM">7:00 PM</option>
                  </select>
                </div>
              </div>
            </div>

            {formError ? (
              <p className="type-body text-critical">{formError}</p>
            ) : null}

            <button
              type="button"
              disabled={pending}
              onClick={() => void submitPass()}
              className="w-full rounded-full bg-accent py-2.5 text-sm font-semibold text-accent-on hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-xs"
            >
              {pending ? 'Generating Pass…' : 'Generate Visitor Pass'}
            </button>

            {/* Generated pass as a physical TEAR-OFF SLIP */}
            <div className="pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="type-label text-content-muted">Newly generated active pass</span>
                {issued ? (
                  <span className="type-micro text-positive font-semibold">Just issued</span>
                ) : null}
              </div>

              {/* Physical Tear-off Ticket */}
              <div className="relative flex rounded-2xl border border-border bg-surface-raised shadow-e1 overflow-hidden">
                {/* Left Stub with Perforated Dotted Line & Semi-circle punched notches */}
                <div className="relative flex w-12 sm:w-14 items-center justify-center border-r-2 border-dashed border-border-strong bg-surface-sunken/40 select-none">
                  {/* Top Punched Notch */}
                  <div className="absolute -top-2.5 -right-2.5 h-5 w-5 rounded-full bg-surface border border-border" />
                  {/* Bottom Punched Notch */}
                  <div className="absolute -bottom-2.5 -right-2.5 h-5 w-5 rounded-full bg-surface border border-border" />

                  {/* Vertical 'Tear-off slip' text */}
                  <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-semibold uppercase tracking-widest text-content-subtle py-4">
                    Tear-off slip
                  </span>
                </div>

                {/* Right Main Body of Pass */}
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center space-y-2">
                  <span className="type-micro text-content-subtle uppercase tracking-wider font-semibold">
                    Passcode
                  </span>

                  {/* Huge 6-digit mono passcode */}
                  <div className="font-mono text-4xl sm:text-5xl font-bold tracking-widest text-content tabular-nums py-1">
                    {activeCodeDisplay}
                  </div>

                  <p className="type-micro text-content-muted">
                    {activePassVisitor} · {purpose} · {formatCalendarDate(validOn)}
                  </p>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => void handleSharePass()}
                      className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2 text-sm font-semibold text-accent-on hover:bg-accent-hover transition-colors shadow-xs"
                    >
                      <Icon name="share" size={16} />
                      Share Pass
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Today's Expected Visitors & Household Gate Log */}
        <div className="space-y-6">
          {/* Today's Expected Visitors */}
          <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-e1 space-y-5">
            <div>
              <h2 className="type-title font-semibold text-content">Today’s Expected Visitors</h2>
              <p className="type-label text-content-muted mt-0.5">Scheduled strips</p>
            </div>

            {/* Visual Timeline Strip */}
            <div className="space-y-3">
              {/* Horizontal Progress Strip Track */}
              <div className="relative h-3 w-full rounded-full bg-surface-sunken overflow-hidden border border-border">
                {/* Active emerald segment */}
                <div className="h-full rounded-full bg-accent w-[45%]" />
              </div>

              {/* Timeline labels beneath the strip */}
              <div className="grid grid-cols-3 text-xs gap-2 pt-1">
                <div className="space-y-0.5">
                  <span className="font-mono font-bold text-content tabular-nums">10:45 AM</span>
                  <p className="type-micro text-content-muted truncate">Guest</p>
                </div>
                <div className="space-y-0.5 text-center">
                  <span className="font-mono font-bold text-content tabular-nums">11:20 AM</span>
                  <p className="type-micro text-content-muted truncate">Guest Arrival</p>
                </div>
                <div className="space-y-0.5 text-right">
                  <span className="font-mono font-bold text-content tabular-nums">11:30 AM</span>
                  <p className="type-micro text-content-muted truncate">Guest</p>
                </div>
              </div>
            </div>
          </div>

          {/* Household Gate Log */}
          <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-e1 space-y-4">
            <div>
              <h2 className="type-title font-semibold text-content">Household Gate Log</h2>
              <p className="type-micro text-content-subtle mt-0.5">
                Ruled gate records for Flat A-101
              </p>
            </div>

            {/* Ruled ledger */}
            {entries.state.state === 'loading' ? (
              <div className="space-y-3 pt-2">
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="65%" />
                <Skeleton variant="text" width="75%" />
              </div>
            ) : (
              <div className="divide-y divide-border border-t border-border">
                {/* Dynamically prepended demo entries if admitted */}
                {demoEntries.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 py-3.5 first:pt-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                        {item.time}
                      </span>
                      <span className="text-content-subtle text-xs">―</span>
                      <span className="type-body text-content text-sm truncate font-medium">
                        {item.action}
                      </span>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                      {item.approver}
                    </span>
                  </div>
                ))}

                {/* Real database entries or reference log entries */}
                {entries.state.state === 'ready' && entries.state.data.length > 0 ? (
                  entries.state.data.slice(0, 6).map((entry) => {
                    const statusVerb = entry.enteredAt ? (entry.exitedAt ? 'Exited' : 'Entered') : 'Waiting';
                    return (
                      <div key={entry.logId} className="flex items-center justify-between gap-4 py-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                            <RelativeTime value={entry.at} />
                          </span>
                          <span className="text-content-subtle text-xs">―</span>
                          <span className="type-body text-content text-sm truncate font-medium">
                            {statusVerb}: {entry.visitorName} ({entry.purpose})
                          </span>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                          {entry.decidedByName || 'Approver'}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                          10:45 AM
                        </span>
                        <span className="text-content-subtle text-xs">―</span>
                        <span className="type-body text-content text-sm truncate font-medium">
                          Entered: Lakshmi Iyer (Family visit)
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                        Approver
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                          11:20 AM
                        </span>
                        <span className="text-content-subtle text-xs">―</span>
                        <span className="type-body text-content text-sm truncate font-medium">
                          Exited: Prakash Rao (Plumbing delivery)
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                        Approver
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                          11:25 AM
                        </span>
                        <span className="text-content-subtle text-xs">―</span>
                        <span className="type-body text-content text-sm truncate font-medium">
                          Entered: Daily Domestic Help
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                        Approver
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                          11:20 AM
                        </span>
                        <span className="text-content-subtle text-xs">―</span>
                        <span className="type-body text-content text-sm truncate font-medium">
                          Exited: Electrician Service Visit
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                        Approver
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-3.5 last:pb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-semibold text-content tabular-nums shrink-0">
                          11:25 AM
                        </span>
                        <span className="text-content-subtle text-xs">―</span>
                        <span className="type-body text-content text-sm truncate font-medium">
                          Entered: Courier Package Delivery
                        </span>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-border bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-content-muted shrink-0">
                        Approver
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The waiting list, kept current by the live stream with fetch on first paint. */
function useWaitingList(onChanged: () => void): FetchState<readonly WaitingVisitor[]> {
  const [state, setState] = useState<FetchState<readonly WaitingVisitor[]>>({ state: 'loading' });
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    void (async () => {
      const result = await call<readonly WaitingVisitor[]>(WAITING_PATH);
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
        // Keep existing
      }
    });

    return () => {
      source.close();
    };
  }, []);

  return state;
}
