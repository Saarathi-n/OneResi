'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Field,
  Input,
  Logo,
  OtpInput,
  Select,
  Skeleton,
  Tabs,
  useToast,
} from '@oneresi/ui';
import { call, useGuardedSession } from '@/lib/session';

/**
 * The gate kiosk: its own mode, not a page in the resident shell. One question at a time, answers
 * sized to read from a metre, and a verdict that fills the screen — the design doc's "the guard
 * never squints". Verify reads a pass code; walk-ins log a visitor against a unit; entry
 * completes the check-in or check-out the verdict started.
 */

import { GATE_REFUSAL_REASON, type GateRefusalReason, type GateVerdict } from '@oneresi/contracts';

/**
 * The verdict word itself. GATE_VERDICTS carries no label map in contracts — the kiosk is its only
 * audience — so the word lives here once, rendered through a map so the raw value never reaches a
 * text node (D-55) while staying readable from a metre (uppercase display type).
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

const LAST_UNIT_KEY = 'oneresi.gate.lastUnit';
const LAST_PURPOSE_KEY = 'oneresi.gate.lastPurpose';

const PURPOSES = ['Delivery', 'Cab', 'Staff', 'Guest', 'Service'];

interface BlockOption {
  blockId: number;
  blockName: string;
  units: { unitId: number; label: string }[];
}

export default function GatePage() {
  // The gate signs in as security staff; the resident shell has no part of this screen.
  const guarded = useGuardedSession();

  const [mode, setMode] = useState('verify');
  const toast = useToast();

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
  const [overrideReason, setOverrideReason] = useState('');
  const [walkInPending, setWalkInPending] = useState(false);
  const [walkInError, setWalkInError] = useState<string | null>(null);
  const [walkInDone, setWalkInDone] = useState<string | null>(null);

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

  if (guarded.state !== 'signed-in') {
    return <GateSkeleton />;
  }

  async function verify(value: string): Promise<void> {
    setVerifyPending(true);
    setVerdict(null);
    setEntryDone(null);
    const result = await call<GateDecision>('/api/gate/verify', {
      method: 'POST',
      json: { code: value },
    });
    setVerifyPending(false);
    setCode('');
    if (result.ok) {
      setVerdict(result.data);
      return;
    }
    toast.show({ title: 'Code not accepted', description: result.error.message, tone: 'critical' });
  }

  async function recordEntry(action: 'CHECK_IN' | 'CHECK_OUT'): Promise<void> {
    if (verdict === null || verdict.verdict !== 'ADMIT') return;
    setEntryPending(true);
    const result = await call<null>('/api/gate/entry', {
      method: 'POST',
      json: { passId: verdict.passId, action },
    });
    setEntryPending(false);
    if (result.ok) {
      setEntryDone(action);
      return;
    }
    toast.show({ title: 'Could not record it', description: result.error.message, tone: 'critical' });
  }

  async function logWalkIn(): Promise<void> {
    if (unitId === '' || visitorName.trim().length < 2) {
      setWalkInError('Choose the unit and type the visitor’s name.');
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
        purpose: purpose === '' ? 'Guest' : purpose,
        ...(overrideReason.trim().length === 0 ? {} : { guardOverride: { reason: overrideReason.trim() } }),
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

  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Logo variant="wordmark" size={28} />
          <p className="type-label text-content-muted">Gate kiosk</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Tabs
          label="Gate"
          value={mode}
          onValueChange={(next) => {
            setMode(next);
            setVerdict(null);
            setEntryDone(null);
            setWalkInDone(null);
          }}
          items={[
            { value: 'verify', label: 'Enter a pass code' },
            { value: 'walkin', label: 'Log a walk-in' },
          ]}
          size="lg"
        >
          {mode === 'verify' ? (
            <div className="mt-8 space-y-8">
              <div>
                <h1 className="type-display text-content">Type the 6-digit code</h1>
                <p className="type-body mt-2 text-content-muted">
                  The resident sends the code; the gate just reads it.
                </p>
              </div>

              {verdict === null ? (
                <div className="rounded-2xl border border-border bg-surface-raised p-8">
                  {verifyPending ? (
                    <Skeleton variant="block" height={80} />
                  ) : (
                    <OtpInput
                      length={6}
                      value={code}
                      onValueChange={setCode}
                      onComplete={(value) => void verify(value)}
                      size="kiosk"
                      label="Pass code"
                      autoFocus
                    />
                  )}
                </div>
              ) : verdict.verdict === 'ADMIT' ? (
                <div
                  className="rounded-2xl bg-positive-soft p-10 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <p className="type-display uppercase tracking-wide text-positive">
                    {VERDICT_WORD.ADMIT}
                  </p>
                  <p className="type-title mt-3 text-content">{verdict.visitorName}</p>
                  <p className="type-body mt-1 text-content-muted">
                    {verdict.purpose} · going to {verdict.destination} · host {verdict.hostName}
                  </p>
                  {entryDone === null ? (
                    <div className="mt-6 flex justify-center gap-3">
                      <Button
                        size="kiosk"
                        pending={entryPending}
                        pendingLabel="Recording it"
                        onClick={() => void recordEntry('CHECK_IN')}
                      >
                        Check in
                      </Button>
                      <Button
                        size="kiosk"
                        variant="secondary"
                        pending={entryPending}
                        pendingLabel="Recording it"
                        onClick={() => void recordEntry('CHECK_OUT')}
                      >
                        Check out
                      </Button>
                    </div>
                  ) : (
                    <p className="type-label mt-6 text-content">
                      {entryDone === 'CHECK_IN' ? 'Checked in' : 'Checked out'} — recorded in the
                      gate log.
                    </p>
                  )}
                </div>
              ) : (
                <div
                  className="rounded-2xl bg-critical-soft p-10 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <p className="type-display uppercase tracking-wide text-critical">
                    {VERDICT_WORD.REFUSE}
                  </p>
                  <p className="type-title mt-3 text-content">
                    {GATE_REFUSAL_REASON[verdict.reason].label}
                  </p>
                  <p className="type-body mt-2 text-content-muted">
                    Do not admit. If the visitor insists, the household can issue a new pass.
                  </p>
                </div>
              )}

              {verdict !== null ? (
                <Button variant="ghost" size="lg" onClick={() => setVerdict(null)}>
                  Next visitor
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              <div>
                <h1 className="type-display text-content">Who is at the gate?</h1>
                <p className="type-body mt-2 text-content-muted">
                  The household gets the request on their screen and answers it.
                </p>
              </div>

              {walkInDone !== null ? (
                <div className="rounded-2xl bg-positive-soft p-8 text-center" role="status">
                  <p className="type-title text-positive">{walkInDone} is logged</p>
                  <p className="type-body mt-2 text-content-muted">
                    The household has been asked to admit or turn them away.
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-4"
                    onClick={() => setWalkInDone(null)}
                  >
                    Log the next one
                  </Button>
                </div>
              ) : (
                <div className="space-y-6 rounded-2xl border border-border bg-surface-raised p-8">
                  {blocks === null ? (
                    <Skeleton variant="block" height={200} />
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
        </Tabs>
      </main>
    </div>
  );
}

function GateSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Logo variant="wordmark" size={28} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Skeleton variant="text" width="60%" height={36} />
        <Skeleton variant="block" height={120} className="mt-8" />
      </main>
    </div>
  );
}
