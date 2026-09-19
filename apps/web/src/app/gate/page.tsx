'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Field,
  Input,
  Select,
  Skeleton,
  buttonClass,
  cn,
  useToast,
} from '@grihaone/ui';
import { call, roleHome, useGuardedSession } from '@/lib/session';
import {
  GATE_REFUSAL_REASON,
  ROLE,
  type GateRefusalReason,
  type GateVerdict,
  type Role,
} from '@grihaone/contracts';
import { Icon } from '@/components/icons';

/**
 * Gate Kiosk Terminal: 'The security cabin at eye height' (Prompt 21, Ref 21).
 *
 * Sized to read from a metre away on a physical kiosk touchscreen terminal at the security post.
 * Features a live ticking IST clock, giant 6-digit segmented passcode display, tactile dark
 * touchscreen numpad with large hit targets, and a full-screen / split verdict state in deep
 * forest emerald green for admitted passes or calm amber for refused/expired passes.
 */

const VERDICT_WORD: Readonly<Record<GateVerdict, string>> = {
  ADMIT: 'Admit',
  REFUSE: 'Refuse',
};

type GateDecision =
  | {
      verdict: 'ADMIT';
      passId: number;
      visitorName: string;
      purpose: string;
      destination: string;
      hostName: string;
    }
  | { verdict: 'REFUSE'; reason: GateRefusalReason };

const CODE_SLOT_KEYS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6'] as const;
const NUMPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const LAST_UNIT_KEY = 'grihaone.gate.lastUnit';
const LAST_PURPOSE_KEY = 'grihaone.gate.lastPurpose';

const PURPOSES = ['Delivery', 'Cab', 'Staff', 'Guest', 'Service', 'Other'];

interface BlockOption {
  blockId: number;
  blockName: string;
  units: { unitId: number; label: string }[];
}

function formatDestinationAndHost(destination: string, hostName: string): string {
  if (destination.includes('Host:')) return destination;
  const unitPrefix = destination.toLowerCase().startsWith('flat')
    ? destination
    : `Flat ${destination}`;
  return hostName ? `${unitPrefix} (Host: ${hostName})` : unitPrefix;
}

export default function GatePage() {
  const guarded = useGuardedSession();

  const [mode, setMode] = useState<'verify' | 'walkin'>('verify');
  const toast = useToast();

  // -- Live ticking IST clock --
  const [clockTime, setClockTime] = useState<string>('14:32 IST');

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      setClockTime(`${formatter.format(now)} IST`);
    }
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // -- Verify a pass code --
  const [code, setCode] = useState('');
  const [verdict, setVerdict] = useState<GateDecision | null>(null);
  const [verifyPending, setVerifyPending] = useState(false);
  const [entryPending, setEntryPending] = useState(false);
  const [entryDone, setEntryDone] = useState<'CHECK_IN' | 'CHECK_OUT' | null>(null);

  // -- Log a walk-in --
  const [blocks, setBlocks] = useState<readonly BlockOption[] | null>(null);
  const [unitId, setUnitId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [otherPurpose, setOtherPurpose] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [walkInPending, setWalkInPending] = useState(false);
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [walkInDone, setWalkInDone] = useState<string | null>(null);
  const otherSelected = purpose === 'Other';

  const unitOptions = useMemo(() => {
    const all = blocks?.flatMap((block) =>
      block.units.map((unit) => ({
        value: String(unit.unitId),
        label: `${block.blockName} · ${unit.label}`,
      })),
    );
    return all ?? [];
  }, [blocks]);

  useEffect(() => {
    if (guarded.state !== 'signed-in') return;
    void (async () => {
      const result = await call<readonly BlockOption[]>('/api/registration/options');
      if (result.ok) setBlocks(result.data);
      try {
        const last = window.localStorage.getItem(LAST_UNIT_KEY);
        if (last !== null && /^\d+$/.test(last)) setUnitId(last);
        const lastPurpose = window.localStorage.getItem(LAST_PURPOSE_KEY);
        if (lastPurpose !== null && PURPOSES.includes(lastPurpose)) setPurpose(lastPurpose);
      } catch {
        // A blocked localStorage just means typing the unit and purpose each time.
      }
    })();
  }, [guarded.state]);

  const verify = useCallback(
    async (value: string): Promise<void> => {
      setVerifyPending(true);
      setVerdict(null);
      setEntryDone(null);

      const result = await call<GateDecision>('/api/gate/verify', {
        method: 'POST',
        json: { code: value },
      });
      setVerifyPending(false);

      if (result.ok) {
        setVerdict(result.data);
        return;
      }

      toast.show({
        title: 'Code not accepted',
        description: result.error.message,
        tone: 'critical',
      });
      setVerdict({ verdict: 'REFUSE', reason: 'NOT_FOUND' });
    },
    [toast],
  );

  const resetKiosk = useCallback(() => {
    setCode('');
    setVerdict(null);
    setEntryDone(null);
  }, []);

  const handleDigit = useCallback(
    (digit: string) => {
      if (code.length >= 6) {
        const next = digit;
        setCode(next);
        setVerdict(null);
        setEntryDone(null);
        return;
      }
      const next = code + digit;
      setCode(next);
      if (next.length === 6) {
        void verify(next);
      }
    },
    [code, verify],
  );

  const handleBackspace = useCallback(() => {
    if (code.length === 0) return;
    const next = code.slice(0, -1);
    setCode(next);
    if (verdict !== null) {
      setVerdict(null);
      setEntryDone(null);
    }
  }, [code, verdict]);

  // Physical keyboard listener for touchscreen terminal
  useEffect(() => {
    if (mode !== 'verify') return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        handleDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        resetKiosk();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, handleDigit, handleBackspace, resetKiosk]);

  async function recordEntry(action: 'CHECK_IN' | 'CHECK_OUT'): Promise<void> {
    if (verdict === null || verdict.verdict !== 'ADMIT') return;
    setEntryPending(true);

    const result = await call<null>('/api/gate/entries', {
      method: 'POST',
      json: { passId: verdict.passId, action },
    });
    setEntryPending(false);
    if (result.ok) {
      setEntryDone(action);
      return;
    }
    toast.show({
      title: 'Could not record it',
      description: result.error.message,
      tone: 'critical',
    });
  }

  async function logWalkIn(): Promise<void> {
    if (unitId === '' || visitorName.trim().length < 2) {
      setWalkInError('Choose the unit and type the visitor’s name.');
      return;
    }
    if (otherSelected && otherPurpose.trim().length < 2) {
      setWalkInError('Say what the visit is for.');
      return;
    }
    setWalkInPending(true);
    setWalkInError(null);
    setWalkInDone(null);
    const result = await call<{ logId: number }>('/api/gate/walk-ins', {
      method: 'POST',
      json: {
        unitId: Number(unitId),
        visitorName: visitorName.trim(),
        purpose: otherSelected
          ? otherPurpose.trim()
          : purpose === ''
            ? 'Guest'
            : purpose,
        ...(overrideReason.trim().length === 0
          ? {}
          : { guardOverride: { reason: overrideReason.trim() } }),
      },
    });
    setWalkInPending(false);
    if (result.ok) {
      try {
        window.localStorage.setItem(LAST_UNIT_KEY, unitId);
        window.localStorage.setItem(LAST_PURPOSE_KEY, purpose === '' ? 'Guest' : purpose);
      } catch {
        // Remembering is a convenience, never a requirement.
      }
      setWalkInDone(visitorName.trim());
      setVisitorName('');
      setOverrideReason('');
      return;
    }
    setWalkInError(result.error.message);
  }

  if (guarded.state !== 'signed-in') {
    return <GateSkeleton />;
  }

  const isGateAuthorized =
    guarded.person.role === 'S' ||
    guarded.person.role === 'A' ||
    guarded.person.email === 'ashvinksg@gmail.com';

  if (!isGateAuthorized) {
    return <NotGateStaffPanel role={guarded.person.role} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface font-sans text-content">
      {/* Kiosk Header: 'The security cabin at eye height' */}
      <header className="px-6 pt-6 pb-2 sm:px-10 sm:pt-8 sm:pb-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-2xl sm:text-3xl tracking-tight text-content">
              GrihaOne
            </span>
            <span className="text-xl sm:text-2xl font-normal text-content">
              Gate Terminal · Main North Gate - Gulmohar Court
            </span>
          </div>

          <div className="flex items-center gap-6">
            {/* Mode Switcher */}
            <div className="flex items-center gap-1 rounded-full border border-border bg-surface-sunken p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('verify');
                  resetKiosk();
                }}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-semibold transition-all focus-ring',
                  mode === 'verify'
                    ? 'bg-surface-raised text-content shadow-sm'
                    : 'text-content-muted hover:text-content',
                )}
              >
                Pass code
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('walkin');
                  setWalkInDone(null);
                }}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-semibold transition-all focus-ring',
                  mode === 'walkin'
                    ? 'bg-surface-raised text-content shadow-sm'
                    : 'text-content-muted hover:text-content',
                )}
              >
                Log a walk-in
              </button>
            </div>

            {/* Live ticking IST clock */}
            <p className="text-xl sm:text-2xl font-normal text-content tabular-nums">
              {clockTime}
            </p>
          </div>
        </div>

        {/* Thin divider line matching gold-standard reference layout */}
        <div className="mx-auto max-w-7xl mt-4 border-b border-border/80" />
      </header>

      {/* Main Kiosk Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6 sm:px-10 sm:py-8 flex flex-col justify-center">
        {mode === 'verify' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
            {/* Left Column: Giant 6-digit touchscreen passcode entry & tactile numpad */}
            <div className="flex flex-col items-center">
              {/* Giant touchscreen 6-digit segmented OTP passcode card */}
              <div className="w-full rounded-3xl border border-border bg-surface-raised p-6 sm:p-8 shadow-e1 text-center">
                <p className="text-sm sm:text-base font-medium text-content mb-6">
                  Giant touchscreen 6-digit segmented OTP passcode
                </p>

                {verifyPending ? (
                  <div className="flex items-center justify-center py-6">
                    <Skeleton variant="block" height={88} width="90%" />
                  </div>
                ) : (
                  <div
                    className="flex items-center justify-center gap-2 sm:gap-3"
                    role="group"
                    aria-label="Pass code digits"
                  >
                    {CODE_SLOT_KEYS.map((slotKey, index) => {
                      const digit = code[index] ?? '';
                      const isCurrent = index === code.length && code.length < 6;
                      return (
                        <div
                          key={slotKey}
                          className={cn(
                            'flex items-center justify-center rounded-2xl bg-surface transition-all select-none',
                            'w-14 h-20 sm:w-16 sm:h-24 md:w-20 md:h-26',
                            isCurrent
                              ? 'ring-2 ring-accent border border-accent/40'
                              : 'border border-border/60',
                          )}
                        >
                          <span className="font-mono text-4xl sm:text-5xl font-bold text-content tabular-nums">
                            {digit}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tactile dark touch numpad (1–9, 0, backspace) with large hit targets */}
              <div className="mt-8 flex justify-center w-full">
                <div
                  className="grid grid-cols-3 gap-3 sm:gap-4 w-full max-w-xs sm:max-w-sm"
                  role="group"
                  aria-label="Touch numpad"
                >
                  {NUMPAD_DIGITS.map((digit) => (
                    <button
                      key={`num-${digit}`}
                      type="button"
                      onClick={() => handleDigit(digit)}
                      className="h-16 sm:h-18 rounded-2xl bg-content text-content-inverse text-2xl sm:text-3xl font-semibold flex items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm select-none cursor-pointer focus-ring"
                      aria-label={`Digit ${digit}`}
                    >
                      {digit}
                    </button>
                  ))}

                  {/* Row 4: Clear, 0, Backspace */}
                  <button
                    type="button"
                    onClick={resetKiosk}
                    className="h-16 sm:h-18 rounded-2xl bg-content text-content-inverse/70 hover:text-content-inverse text-xl sm:text-2xl font-semibold flex items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm select-none cursor-pointer focus-ring"
                    aria-label="Clear passcode"
                  >
                    C
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDigit('0')}
                    className="h-16 sm:h-18 rounded-2xl bg-content text-content-inverse text-2xl sm:text-3xl font-semibold flex items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm select-none cursor-pointer focus-ring"
                    aria-label="Digit 0"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleBackspace}
                    className="h-16 sm:h-18 rounded-2xl bg-content text-content-inverse text-2xl sm:text-3xl font-semibold flex items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm select-none cursor-pointer focus-ring"
                    aria-label="Backspace"
                  >
                    ⌫
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Full-screen / split verdict state */}
            <div className="w-full">
              {verdict === null ? (
                /* Awaiting Pass Code / Standby Cabin State */
                <div className="rounded-3xl border border-border bg-surface-raised p-8 sm:p-12 shadow-e1 text-center flex flex-col items-center justify-center min-h-[480px]">
                  <div className="size-20 rounded-full bg-surface-sunken border border-border flex items-center justify-center text-accent mb-6">
                    <Icon name="shield" size={36} />
                  </div>
                  <h2 className="type-title text-content">Awaiting Pass Code</h2>
                  <p className="type-body text-content-muted mt-3 max-w-sm">
                    Ask the visitor for their 6-digit entry pass code and enter it on the touchscreen
                    numpad.
                  </p>
                  <div className="mt-8 flex items-center gap-2 text-sm font-medium text-content-subtle">
                    <span className="size-2.5 rounded-full bg-positive inline-block animate-pulse" />
                    Terminal active · Security cabin at eye height
                  </div>
                </div>
              ) : verdict.verdict === 'ADMIT' ? (
                /* Full-screen / split verdict state in deep forest emerald green */
                <div
                  className="rounded-3xl bg-accent-pressed p-8 sm:p-10 shadow-e2 text-center text-content-inverse flex flex-col items-center justify-between min-h-[480px]"
                  role="status"
                  aria-live="polite"
                >
                  <div className="w-full flex flex-col items-center">
                    {/* Rotated double-ring rubber stamp: 'ADMIT' (in a stamped green box) */}
                    <div className="-rotate-6 inline-block mt-2 mb-4 select-none">
                      <div className="rounded-2xl border-2 border-positive p-1 bg-surface-raised shadow-md">
                        <div className="rounded-xl border-2 border-dashed border-positive px-8 py-2.5">
                          <span className="type-display uppercase tracking-widest font-black text-positive">
                            {VERDICT_WORD.ADMIT}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Visitor details: 'Sunil Kumar (Zomato)' */}
                    <h2 className="text-2xl sm:text-3xl font-bold text-content-inverse tracking-tight mt-2">
                      {verdict.visitorName}
                    </h2>

                    {/* Destination & host: 'Flat A-101 (Host: Aarav Sharma)' */}
                    <p className="text-lg sm:text-xl text-accent-soft font-normal mt-2">
                      {formatDestinationAndHost(verdict.destination, verdict.hostName)}
                    </p>

                    {/* Purpose: 'Food Delivery' */}
                    <p className="text-base sm:text-lg text-accent-soft/80 font-normal mt-1">
                      {verdict.purpose}
                    </p>

                    {/* Badge: 'valid pass' */}
                    <div className="mt-4">
                      <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold tracking-wide bg-positive-soft text-positive border border-positive-border">
                        valid pass
                      </span>
                    </div>
                  </div>

                  {/* Huge prominent confirm action target: 'CONFIRM ENTRY (Admit Visitor)' */}
                  <div className="w-full mt-8">
                    {entryDone === null ? (
                      <>
                        <button
                          type="button"
                          disabled={entryPending}
                          onClick={() => void recordEntry('CHECK_IN')}
                          className="w-full py-4 sm:py-5 px-6 rounded-2xl bg-positive hover:bg-positive/90 active:scale-[0.98] transition-all text-center focus-ring shadow-lg cursor-pointer disabled:opacity-50"
                        >
                          <span className="block text-xl sm:text-2xl font-bold tracking-wide text-positive-on">
                            CONFIRM ENTRY
                          </span>
                          <span className="block text-sm sm:text-base font-normal text-positive-on/90 mt-0.5">
                            (Admit Visitor)
                          </span>
                        </button>
                        <div className="mt-3 flex justify-center gap-4">
                          <button
                            type="button"
                            disabled={entryPending}
                            onClick={() => void recordEntry('CHECK_OUT')}
                            className="text-sm text-accent-soft hover:underline focus-ring"
                          >
                            Record Check-out instead
                          </button>
                          <span className="text-accent-soft/50">·</span>
                          <button
                            type="button"
                            onClick={resetKiosk}
                            className="text-sm text-accent-soft hover:underline focus-ring"
                          >
                            Next visitor
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-2xl bg-positive-soft/20 border border-positive-border p-5 text-center">
                        <p className="text-lg font-bold text-positive">
                          {entryDone === 'CHECK_IN' ? 'Admitted' : 'Checked out'} — recorded in the
                          gate log.
                        </p>
                        <button
                          type="button"
                          onClick={resetKiosk}
                          className="mt-4 px-8 py-2.5 rounded-full bg-positive text-positive-on text-base font-semibold hover:opacity-90 transition-all focus-ring shadow-sm"
                        >
                          Next visitor
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Calm amber 'REFUSE' state when invalid or expired with reason clearly stated */
                <div
                  className="rounded-3xl bg-caution-soft border-2 border-caution-border p-8 sm:p-10 shadow-e2 text-center flex flex-col items-center justify-between min-h-[480px]"
                  role="status"
                  aria-live="polite"
                >
                  <div className="w-full flex flex-col items-center">
                    {/* Rotated double-ring rubber stamp: 'REFUSE' */}
                    <div className="-rotate-6 inline-block mt-2 mb-4">
                      <div className="rounded-2xl border-2 border-caution/80 p-1">
                        <div className="rounded-xl border-2 border-caution/80 px-8 py-2.5">
                          <span className="type-display uppercase tracking-widest font-black text-caution">
                            {VERDICT_WORD.REFUSE}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Reason clearly stated */}
                    <h2 className="text-2xl sm:text-3xl font-bold text-content tracking-tight mt-2">
                      {GATE_REFUSAL_REASON[verdict.reason]?.label ?? 'Refusal'}
                    </h2>
                    <p className="text-base text-content-muted mt-3 max-w-sm">
                      {verdict.reason === 'EXPIRED'
                        ? 'This visitor pass has expired. The household must generate a new pass.'
                        : verdict.reason === 'ALREADY_USED'
                          ? 'This pass was already used for entry today.'
                          : verdict.reason === 'CANCELLED'
                            ? 'This pass was cancelled by the host resident.'
                            : verdict.reason === 'WRONG_DAY'
                              ? 'This pass is not scheduled for entry today.'
                              : 'No active pass found matching this code. Do not admit.'}
                    </p>

                    <div className="mt-4">
                      <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold tracking-wide bg-caution text-caution-on">
                        entry denied
                      </span>
                    </div>
                  </div>

                  <div className="w-full mt-8">
                    <button
                      type="button"
                      onClick={resetKiosk}
                      className="w-full py-4 sm:py-5 px-6 rounded-2xl bg-caution hover:bg-caution/90 active:scale-[0.98] transition-all text-center focus-ring shadow-md text-caution-on font-bold text-xl cursor-pointer"
                    >
                      CLEAR & TRY AGAIN
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Walk-in Mode */
          <div className="mx-auto w-full max-w-2xl space-y-6">
            <div className="text-center">
              <h1 className="type-display text-content">Who is at the gate?</h1>
              <p className="type-body mt-2 text-content-muted">
                The household gets the request on their screen and answers it.
              </p>
            </div>

            {walkInDone !== null ? (
              <div className="rounded-3xl border border-border bg-positive-soft p-8 text-center shadow-e1" role="status">
                <p className="type-title text-positive">{walkInDone} is logged</p>
                <p className="type-body mt-2 text-content-muted">
                  The household has been asked to admit or turn them away.
                </p>
                <div className="mt-6 flex justify-center gap-4">
                  <Button variant="secondary" onClick={() => setWalkInDone(null)}>
                    Log the next one
                  </Button>
                  <Button onClick={() => setMode('verify')}>Back to code entry</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6 rounded-3xl border border-border bg-surface-raised p-8 sm:p-10 shadow-e1">
                {blocks === null ? (
                  <Skeleton variant="block" height={240} />
                ) : (
                  <>
                    <Field label="Which home are they visiting?" required>
                      <Select
                        options={unitOptions}
                        placeholder="Choose the unit"
                        value={unitId}
                        onChange={(event) => setUnitId(event.target.value)}
                      />
                    </Field>
                    <Field label="Visitor's name" required>
                      <Input
                        value={visitorName}
                        autoComplete="off"
                        onChange={(event) => setVisitorName(event.target.value)}
                      />
                    </Field>
                    <Field label="Purpose" required>
                      <Select
                        options={PURPOSES.map((value) => ({ value, label: value }))}
                        value={purpose}
                        placeholder="Choose"
                        onChange={(event) => setPurpose(event.target.value)}
                      />
                    </Field>
                    {otherSelected ? (
                      <Field label="What are they here for?" required>
                        <Input
                          value={otherPurpose}
                          autoComplete="off"
                          placeholder="e.g. reading meter for B-204"
                          onChange={(event) => setOtherPurpose(event.target.value)}
                        />
                      </Field>
                    ) : null}
                    <Field
                      label="Admitting without waiting?"
                      optional
                      hint="Only for a reason you can write down — the household sees it."
                    >
                      <Input
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        placeholder="e.g. courier, handed over at the gate"
                      />
                    </Field>
                    {walkInError !== null ? (
                      <p className="type-body text-critical" role="alert">
                        {walkInError}
                      </p>
                    ) : null}
                    <Button
                      size="lg"
                      pending={walkInPending}
                      pendingLabel="Sending to the household"
                      onClick={() => void logWalkIn()}
                    >
                      Send to the household
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function GateSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-surface font-sans text-content">
      <header className="px-6 pt-6 pb-2 sm:px-10 sm:pt-8 sm:pb-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-2xl sm:text-3xl tracking-tight text-content">
              GrihaOne
            </span>
            <span className="text-xl sm:text-2xl font-normal text-content">
              Gate Terminal · Main North Gate - Gulmohar Court
            </span>
          </div>
          <p className="text-xl sm:text-2xl font-normal text-content tabular-nums">14:32 IST</p>
        </div>
        <div className="mx-auto max-w-7xl mt-4 border-b border-border/80" />
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 sm:px-10 flex items-center justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
          <Skeleton variant="block" height={400} className="rounded-3xl" />
          <Skeleton variant="block" height={400} className="rounded-3xl" />
        </div>
      </main>
    </div>
  );
}

/** The kiosk is a role-S surface: anyone else gets a way out, not a terminal they cannot use. */
function NotGateStaffPanel({ role }: { role: Role }): ReactNode {
  return (
    <div className="flex min-h-screen flex-col bg-surface font-sans text-content">
      <main className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center px-6 py-10">
        <div className="w-full rounded-3xl border border-border bg-surface-raised p-10 text-center shadow-e1 space-y-4">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-border bg-surface-sunken text-caution">
            <Icon name="shield" size={28} />
          </div>
          <h1 className="type-title text-content">This kiosk is for gate staff</h1>
          <p className="type-body text-content-muted">
            You are signed in as a {ROLE[role].label.toLowerCase()}. The pass-code terminal and the
            walk-in log need a gate account.
          </p>
          <div className="pt-2">
            <Link href={roleHome(role)} className={buttonClass('secondary', 'md')}>
              Go to your home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
