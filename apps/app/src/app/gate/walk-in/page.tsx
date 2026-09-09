'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Field, Input, Select, Textarea } from '@oneresi/ui';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { call, simple } from '@/lib/api';
import { screenClass } from '@/lib/motion';
import type { RegistrationOptionsWire } from '@/lib/types';
import { readWalkInPrefill, writeWalkInPrefill } from '../lib/checkin-store';
import { formatTimeOfDay } from '../lib/time';

/**
 * The walk-in form: a visitor with no pass code. Two paths, and the guard picks one with a thumb
 * — ask the household (the visit waits for the resident's phone) or let them in now and say why
 * (the override is recorded against the guard's name). The block and flat pre-fill from the last
 * walk-in logged on this device, because a gate sees the same handful of flats all day.
 *
 * Walk-ins are never queued for replay: the request carries no idempotency key, so a retried
 * write could log the same visit twice. Offline, the guard is told plainly and retries.
 */

const PURPOSES = ['Delivery', 'Cab', 'Guest', 'Staff', 'Service visit'] as const;
const PHONE_PATTERN = /^(?:\+91)?[6-9]\d{9}$/;

type Decision = 'ASK' | 'OVERRIDE';

/** Collected field by field during validation, so the fields are mutable like register's. */
interface FormErrors {
  blockId?: string | undefined;
  unitId?: string | undefined;
  visitorName?: string | undefined;
  phone?: string | undefined;
  purpose?: string | undefined;
  overrideReason?: string | undefined;
}

interface Submitted {
  readonly name: string;
  readonly unitLabel: string;
  readonly purpose: string;
  readonly override: boolean;
  readonly at: string;
}

function emptyErrors(): FormErrors {
  return {};
}

export default function WalkInPage(): ReactNode {
  const reduced = useReducedMotion();
  const options = useAsync(
    () => simple<readonly RegistrationOptionsWire[]>('/api/registration/options'),
    [],
  );

  const [blockId, setBlockId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [decision, setDecision] = useState<Decision>('ASK');
  const [overrideReason, setOverrideReason] = useState('');
  const [errors, setErrors] = useState<FormErrors>(emptyErrors);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  // The last flat this gate logged a walk-in for — one tap from done for the regulars.
  useEffect(() => {
    const prefill = readWalkInPrefill();
    if (prefill === null) return;
    setBlockId(String(prefill.blockId));
    setUnitId(String(prefill.unitId));
  }, []);

  const blocks = options.state.state === 'ready' ? options.state.data : [];

  const selectedBlock = useMemo(
    () => blocks.find((block) => String(block.blockId) === blockId),
    [blocks, blockId],
  );
  const units = useMemo(() => selectedBlock?.units ?? [], [selectedBlock]);

  // A pre-filled block may not exist in this society's list (stale device, changed data): fall
  // back to an empty choice rather than a select showing a value it cannot name.
  useEffect(() => {
    if (options.state.state !== 'ready') return;
    if (blockId !== '' && selectedBlock === undefined) {
      setBlockId('');
      setUnitId('');
    } else if (unitId !== '' && !units.some((unit) => String(unit.unitId) === unitId)) {
      setUnitId('');
    }
  }, [options.state, blockId, selectedBlock, unitId, units]);

  const unitLabel = units.find((unit) => String(unit.unitId) === unitId)?.label;

  const submit = useCallback(async (): Promise<void> => {
    const trimmedName = visitorName.trim();
    const trimmedPurpose = purpose.trim();
    const trimmedReason = overrideReason.trim();
    const phoneDigits = phone.replace(/[\s()-]/g, '');

    const next: FormErrors = {};
    if (blockId === '') next.blockId = 'Pick the block.';
    if (unitId === '') next.unitId = 'Pick the flat or house they are visiting.';
    if (trimmedName.length < 2) next.visitorName = 'Enter the visitor’s name.';
    if (trimmedPurpose.length < 2) next.purpose = 'Say what they are here for.';
    if (phoneDigits !== '' && !PHONE_PATTERN.test(phoneDigits)) {
      next.phone = 'Enter a 10-digit mobile number, or leave it blank.';
    }
    if (decision === 'OVERRIDE' && trimmedReason.length < 4) {
      next.overrideReason = 'Say why you are letting them in without asking.';
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    setErrors(emptyErrors);
    setServerError(null);
    setPending(true);

    const outcome = await call<{ logId: number }>('/api/gate/walk-ins', {
      method: 'POST',
      json: {
        unitId: Number(unitId),
        visitorName: trimmedName,
        purpose: trimmedPurpose,
        ...(phoneDigits !== '' ? { phone: phoneDigits } : {}),
        ...(decision === 'OVERRIDE' ? { guardOverride: { reason: trimmedReason } } : {}),
      },
    });
    setPending(false);

    if (outcome.ok) {
      writeWalkInPrefill({ blockId: Number(blockId), unitId: Number(unitId) });
      setSubmitted({
        name: trimmedName,
        unitLabel: unitLabel ?? '',
        purpose: trimmedPurpose,
        override: decision === 'OVERRIDE',
        at: new Date().toISOString(),
      });
      return;
    }

    if ('network' in outcome && outcome.network) {
      setServerError(
        'You appear to be offline, and the walk-in was not recorded. Wait for a signal and log it again.',
      );
      return;
    }

    const field = outcome.error.field;
    if (
      field === 'unitId' ||
      field === 'visitorName' ||
      field === 'phone' ||
      field === 'purpose' ||
      field === 'guardOverride'
    ) {
      setErrors({ [field]: outcome.error.message });
    } else {
      setServerError(outcome.error.message);
    }
  }, [blockId, unitId, visitorName, purpose, phone, decision, overrideReason, unitLabel]);

  const resetForm = useCallback(() => {
    setVisitorName('');
    setPhone('');
    setPurpose('');
    setDecision('ASK');
    setOverrideReason('');
    setErrors(emptyErrors);
    setServerError(null);
    setSubmitted(null);
  }, []);

  if (submitted !== null) {
    return (
      <Shell title="Log a walk-in" backHref="/gate">
        <div className={screenClass('forward', reduced)}>
          <div role="status" aria-live="polite">
            <Card tone={submitted.override ? 'caution' : 'positive'} padding="roomy">
              <p className="text-[32px] font-bold leading-tight">
                {submitted.override ? 'Recorded — let them in' : 'The household has been asked'}
              </p>
              <p className="mt-4 type-title font-medium">{submitted.name}</p>
              <p className="mt-1 type-body text-content-subtle">
                {submitted.unitLabel} · for {submitted.purpose} · at {formatTimeOfDay(submitted.at)}
              </p>
              <p className="mt-4 type-label text-content-subtle">
                {submitted.override
                  ? 'Logged under your name with the reason you gave. The household has been told.'
                  : 'They can answer from their phone. Let the visitor through once the resident says yes.'}
              </p>
              <div className="mt-8">
                <Button size="kiosk" fullWidth onClick={resetForm}>
                  Log another walk-in
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Log a walk-in" backHref="/gate">
      <div className={screenClass('forward', reduced)}>
        <p className="type-body text-content-subtle">
          For a visitor with no pass code: ask the household from here, or let them in and say why.
        </p>
        <div className="mt-4">
          <AsyncView
            state={options.state}
            skeleton={<CardListSkeleton rows={2} />}
            render={() => (
              <form
                className="flex flex-col gap-5"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <Field label="Block" required error={errors.blockId}>
                  <Select
                    value={blockId}
                    onChange={(event) => {
                      setBlockId(event.target.value);
                      setUnitId('');
                    }}
                    options={blocks.map((block) => ({
                      value: String(block.blockId),
                      label: block.blockName,
                    }))}
                    placeholder="Choose the block"
                    invalid={errors.blockId !== undefined}
                  />
                </Field>

                <Field label="Flat or house" required error={errors.unitId}>
                  <Select
                    value={unitId}
                    onChange={(event) => {
                      setUnitId(event.target.value);
                    }}
                    options={units.map((unit) => ({
                      value: String(unit.unitId),
                      label: unit.label,
                    }))}
                    placeholder={blockId === '' ? 'Choose a block first' : 'Choose the flat or house'}
                    disabled={blockId === ''}
                    invalid={errors.unitId !== undefined}
                  />
                </Field>

                <Field label="Visitor's name" required error={errors.visitorName}>
                  <Input
                    value={visitorName}
                    onChange={(event) => {
                      setVisitorName(event.target.value);
                    }}
                    autoComplete="off"
                    invalid={errors.visitorName !== undefined}
                  />
                </Field>

                <Field
                  label="Mobile number"
                  hint="Optional — a 10-digit number lets the resident call them"
                  error={errors.phone}
                >
                  <Input
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                    }}
                    inputMode="tel"
                    autoComplete="off"
                    invalid={errors.phone !== undefined}
                  />
                </Field>

                <Field label="What are they here for?" required error={errors.purpose}>
                  <div>
                    <div className="flex flex-wrap gap-2">
                      {PURPOSES.map((quick) => (
                        <button
                          key={quick}
                          type="button"
                          aria-pressed={purpose === quick}
                          onClick={() => {
                            setPurpose(quick);
                          }}
                          className={
                            purpose === quick
                              ? 'tab-target rounded-pill border border-accent bg-accent px-4 py-2 type-label font-medium text-accent-on focus-ring'
                              : 'tab-target rounded-pill border border-border bg-surface-raised px-4 py-2 type-label font-medium text-content focus-ring'
                          }
                        >
                          {quick}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3">
                      <Input
                        value={purpose}
                        onChange={(event) => {
                          setPurpose(event.target.value);
                        }}
                        autoComplete="off"
                        invalid={errors.purpose !== undefined}
                      />
                    </div>
                  </div>
                </Field>

                <fieldset>
                  <legend className="type-label uppercase tracking-wide text-content-subtle">
                    Who decides?
                  </legend>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      aria-pressed={decision === 'ASK'}
                      onClick={() => {
                        setDecision('ASK');
                      }}
                      className={
                        decision === 'ASK'
                          ? 'tab-target min-h-24 rounded-xl border-2 border-accent bg-surface-raised p-4 text-left focus-ring'
                          : 'tab-target min-h-24 rounded-xl border border-border bg-surface-raised p-4 text-left focus-ring'
                      }
                    >
                      <span className="block type-body font-semibold">Ask the household</span>
                      <span className="mt-1 block type-label text-content-subtle">
                        They answer on their phone
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={decision === 'OVERRIDE'}
                      onClick={() => {
                        setDecision('OVERRIDE');
                      }}
                      className={
                        decision === 'OVERRIDE'
                          ? 'tab-target min-h-24 rounded-xl border-2 border-accent bg-surface-raised p-4 text-left focus-ring'
                          : 'tab-target min-h-24 rounded-xl border border-border bg-surface-raised p-4 text-left focus-ring'
                      }
                    >
                      <span className="block type-body font-semibold">Let them in now</span>
                      <span className="mt-1 block type-label text-content-subtle">
                        Recorded under your name
                      </span>
                    </button>
                  </div>
                </fieldset>

                {decision === 'OVERRIDE' ? (
                  <Field
                    label="Why are you letting them in?"
                    hint="Recorded against your name in the society log"
                    required
                    error={errors.overrideReason}
                  >
                    <Textarea
                      value={overrideReason}
                      onChange={(event) => {
                        setOverrideReason(event.target.value);
                      }}
                      rows={3}
                      maxLength={200}
                      showCount
                      placeholder="e.g. Resident called the gate and asked to send them up"
                      invalid={errors.overrideReason !== undefined}
                    />
                  </Field>
                ) : null}

                {serverError !== null ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-critical-border bg-critical-soft px-3 py-2 type-label text-critical"
                  >
                    {serverError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  size="kiosk"
                  fullWidth
                  pending={pending}
                  pendingLabel="Logging the walk-in"
                >
                  {decision === 'OVERRIDE' ? 'Let them in and record it' : 'Ask the household'}
                </Button>
              </form>
            )}
            onRetry={() => {
              options.reload();
            }}
          />
        </div>
      </div>
    </Shell>
  );
}
