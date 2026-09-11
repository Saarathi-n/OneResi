'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button, Field, Input, Logo, Select, Textarea, Stepper } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { simple } from '@/lib/api';
import type { RegistrationOptionsWire } from '@/lib/types';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle, screenClass } from '@/lib/motion';

/**
 * Registration in four steps with a real stepper, per-field validation on blur, and a draft that
 * persists to localStorage on every change — closing the tab mid-registration costs nothing
 * (D-71). The home step claims rather than creates: an applicant who cannot find their flat
 * describes it, and the committee resolves the claim at approval (D-04). Nothing here can create
 * a unit or set a charge.
 */

const DRAFT_KEY = 'oneresi.register-draft.v1';

interface Draft {
  step: number;
  blockId: string;
  unitId: string;
  claiming: boolean;
  claimBlock: string;
  claimUnit: string;
  claimType: string;
  claimNote: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const EMPTY_DRAFT: Draft = {
  step: 0,
  blockId: '',
  unitId: '',
  claiming: false,
  claimBlock: '',
  claimUnit: '',
  claimType: '',
  claimNote: '',
  name: '',
  phone: '',
  email: '',
  password: '',
  confirmPassword: '',
};

const STEPS = [
  { id: 'home', label: 'Your home', hint: 'Block and flat' },
  { id: 'about', label: 'About you', hint: 'Name and contact' },
  { id: 'password', label: 'Password', hint: 'Something only you know' },
  { id: 'review', label: 'Review', hint: 'Check and submit' },
] as const;

function loadDraft(): { draft: Draft; restored: boolean } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw === null) return { draft: EMPTY_DRAFT, restored: false };
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      draft: { ...EMPTY_DRAFT, ...parsed, step: Math.min(Math.max(parsed.step ?? 0, 0), 3) },
      restored: true,
    };
  } catch {
    return { draft: EMPTY_DRAFT, restored: false };
  }
}

// ---------------------------------------------------------------- validation (on blur, never on keystroke)

interface FieldErrors {
  block?: string;
  unit?: string;
  claimBlock?: string;
  claimUnit?: string;
  claimType?: string;
  name?: string;
  phone?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

function validateStep(draft: Draft, step: number): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 0) {
    if (draft.claiming) {
      if (draft.claimBlock.trim().length === 0) errors.claimBlock = 'Name your block or building';
      if (draft.claimUnit.trim().length === 0) errors.claimUnit = 'Enter your flat or plot number';
      if (draft.claimType === '') errors.claimType = 'Pick the closest match';
    } else {
      if (draft.blockId === '') errors.block = 'Choose your block';
      if (draft.unitId === '') errors.unit = 'Choose your flat';
    }
  }
  if (step === 1) {
    if (draft.name.trim().length < 2) errors.name = 'Enter your full name';
    if (!/^(?:\+91)?[6-9]\d{9}$/.test(draft.phone.replace(/[\s()-]/g, ''))) {
      errors.phone = 'Enter a 10-digit Indian mobile number';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      errors.email = 'Enter a valid email address';
    }
  }
  if (step === 2) {
    const verdict = passwordVerdict(draft.password);
    if (!verdict.acceptable) errors.password = verdict.firstProblem ?? 'Choose a stronger password';
    if (draft.confirmPassword !== draft.password) {
      errors.confirmPassword = 'The two passwords do not match';
    }
  }
  return errors;
}

/** Mirrors the shared password policy in @oneresi/contracts, so client and server cannot disagree. */
function passwordVerdict(password: string): {
  acceptable: boolean;
  firstProblem?: string;
  score: number;
} {
  if (password.length === 0) return { acceptable: false, score: 0 };
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  if (/^(?:password|oneresi|qwerty|12345)/i.test(password)) {
    return { acceptable: false, firstProblem: 'Choose something less common', score };
  }
  if (password.length < 10) {
    return { acceptable: false, firstProblem: 'Use at least 10 characters', score };
  }
  if (!(/[a-z]/.test(password) && /[A-Z]/.test(password))) {
    return { acceptable: false, firstProblem: 'Mix upper and lower case', score };
  }
  if (!(/\d/.test(password) || /[^A-Za-z0-9]/.test(password))) {
    return { acceptable: false, firstProblem: 'Include a number or a symbol', score };
  }
  return { acceptable: true, score };
}

const STRENGTH_LABEL = ['Too simple', 'Could be stronger', 'Reasonable', 'Strong', 'Excellent'];

export default function RegisterPage() {
  const reduced = useReducedMotion();
  const initial = useMemo(loadDraft, []);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [restored] = useState(initial.restored);
  const [touched, setTouched] = useState<Partial<Record<keyof FieldErrors, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverField, setServerField] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const options = useAsync(
    () => simple<readonly RegistrationOptionsWire[]>('/api/registration/options'),
    [],
  );

  useEffect(() => {
    try {
      // The two password fields never reach storage: a draft exists so a refresh does not cost the
      // applicant their typed answers, and retyping a password is one field — while a password in
      // localStorage outlives the tab, the sign-out and the browser's idea of who is logged in.
      const { password: _password, confirmPassword: _confirmPassword, ...rest } = draft;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    } catch {
      // Storage refused (private mode, full). The form still works; only the crash protection is gone.
    }
  }, [draft]);

  const errors = validateStep(draft, draft.step);
  const stepValid = Object.keys(errors).length === 0;

  function update(patch: Partial<Draft>): void {
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  function blur(field: keyof FieldErrors): void {
    setTouched((previous) => ({ ...previous, [field]: true }));
  }

  function showing(field: keyof FieldErrors): string | undefined {
    if (serverField === field) return serverError ?? undefined;
    return touched[field] === true ? errors[field] : undefined;
  }

  function goTo(step: number): void {
    setServerError(null);
    setServerField(null);
    update({ step: Math.min(Math.max(step, 0), 3) });
  }

  function next(): void {
    if (!stepValid) {
      setTouched({
        block: true,
        unit: true,
        claimBlock: true,
        claimUnit: true,
        claimType: true,
        name: true,
        phone: true,
        email: true,
        password: true,
        confirmPassword: true,
      });
      return;
    }
    goTo(draft.step + 1);
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    for (let step = 0; step <= 2; step += 1) {
      if (Object.keys(validateStep(draft, step)).length > 0) {
        goTo(step);
        setTouched({
          block: true,
          unit: true,
          claimBlock: true,
          claimUnit: true,
          claimType: true,
          name: true,
          phone: true,
          email: true,
          password: true,
          confirmPassword: true,
        });
        return;
      }
    }
    setSubmitting(true);
    setServerError(null);
    setServerField(null);

    const home = draft.claiming
      ? {
          kind: 'claim' as const,
          blockName: draft.claimBlock.trim(),
          unitLabel: draft.claimUnit.trim(),
          unitType: draft.claimType as C.UnitType,
          ...(draft.claimNote.trim().length > 0 ? { note: draft.claimNote.trim() } : {}),
        }
      : { kind: 'existing' as const, unitId: Number(draft.unitId) };

    const result = await simple<{ personId: number }>('/api/auth/register', {
      method: 'POST',
      json: {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone,
        password: draft.password,
        home,
      },
    });
    setSubmitting(false);
    if (result.ok) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to clean up worth interrupting the person about.
      }
      setSubmitted(true);
      return;
    }
    setServerError(result.error.message);
    setServerField(result.error.field ?? null);
    if (result.error.fields !== undefined && result.error.fields.length > 0) {
      setServerField(result.error.fields[0] ?? null);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-6 py-10">
        <div className={screenClass('forward', reduced)}>
          <span className="flex size-14 items-center justify-center rounded-full border border-positive-border bg-positive-soft text-positive">
            <Icon name="check" size={28} />
          </span>
          <h1 className="type-title mt-4">You are on the list</h1>
          <p className="type-body text-content-muted">
            The committee reviews applications daily; you will get an email either way. Until your
            application is approved you cannot sign in — this is what keeps a stranger out of the
            society&rsquo;s records.
          </p>
          <div className="mt-2 flex flex-col gap-3">
            <Link href="/sign-in" className="text-accent focus-ring rounded-sm type-body">
              Back to sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const blocks =
    options.state.state === 'ready'
      ? options.state.data
      : ([] as readonly RegistrationOptionsWire[]);
  const chosenBlock = blocks.find((block) => String(block.blockId) === draft.blockId);
  const phoneDigits = draft.phone.replace(/[\s()-]/g, '');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 pb-10 pt-8">
      <div className="flex items-center justify-between">
        <Link href="/sign-in" aria-label="Back to sign in" className="tab-target -ml-2 flex items-center justify-center rounded-lg text-content-muted focus-ring-inset">
          <Icon name="chevron-left" />
        </Link>
        <Logo variant="wordmark" size={26} />
      </div>

      <div className="mt-6">
        <Stepper steps={STEPS} current={draft.step} onStepSelect={goTo} pending={submitting} />
      </div>

      {restored ? (
        <p className="mt-4 rounded-lg border border-info-border bg-info-soft px-4 py-3 type-label text-info">
          Picking up where you left off — your answers were saved on this phone.
        </p>
      ) : null}

      <div key={draft.step} className={screenClass('forward', reduced)} style={rowStyle(0, reduced)}>
        {/* ------------------------------------------------------------ step 1: home */}
        {draft.step === 0 ? (
          <section className="mt-6 flex flex-col gap-4">
            <h2 className="type-title">Where do you live?</h2>
            <p className="type-body text-content-muted">
              Choose your block and flat from the society&rsquo;s list. If yours is not there,
              describe it and the committee will confirm it when they approve you.
            </p>

            {options.state.state === 'failed' ? (
              <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
                The block list did not load. Check your connection — you can still describe your
                home below.
              </p>
            ) : null}

            {draft.claiming ? (
              <>
                <Field label="Block or building" required error={showing('claimBlock')}>
                  <Input
                    value={draft.claimBlock}
                    onChange={(event) => {
                      update({ claimBlock: event.target.value });
                    }}
                    onBlur={() => {
                      blur('claimBlock');
                    }}
                    autoComplete="address-line1"
                  />
                </Field>
                <Field label="Flat or plot number" required error={showing('claimUnit')}>
                  <Input
                    value={draft.claimUnit}
                    onChange={(event) => {
                      update({ claimUnit: event.target.value });
                    }}
                    onBlur={() => {
                      blur('claimUnit');
                    }}
                    autoComplete="address-line2"
                  />
                </Field>
                <Field label="Type of home" required error={showing('claimType')}>
                  <Select
                    value={draft.claimType}
                    placeholder="Choose the closest match"
                    onChange={(event) => {
                      update({ claimType: event.target.value });
                    }}
                    onBlur={() => {
                      blur('claimType');
                    }}
                    options={C.UNIT_TYPES.map((type) => ({
                      value: type,
                      label: C.UNIT_TYPE[type].label,
                    }))}
                  />
                </Field>
                <Field
                  label="Anything the committee should know"
                  optional
                  hint="A wing, a floor, a door number within a duplex — up to 280 characters"
                >
                  <Textarea
                    value={draft.claimNote}
                    maxLength={280}
                    onChange={(event) => {
                      update({ claimNote: event.target.value });
                    }}
                    rows={3}
                  />
                </Field>
                <Button
                  variant="ghost"
                  onClick={() => {
                    update({ claiming: false });
                  }}
                >
                  My flat is on the list
                </Button>
              </>
            ) : (
              <>
                <Field
                  label="Block"
                  required
                  error={showing('block')}
                  pending={options.state.state === 'loading'}
                >
                  <Select
                    value={draft.blockId}
                    placeholder={
                      options.state.state === 'loading' ? 'Loading blocks' : 'Choose your block'
                    }
                    onChange={(event) => {
                      update({ blockId: event.target.value, unitId: '' });
                    }}
                    onBlur={() => {
                      blur('block');
                    }}
                    options={blocks.map((block) => ({
                      value: String(block.blockId),
                      label: block.blockName,
                    }))}
                  />
                </Field>
                <Field
                  label="Flat"
                  required
                  error={showing('unit')}
                  hint={chosenBlock === undefined ? 'Choose a block first' : undefined}
                >
                  <Select
                    value={draft.unitId}
                    placeholder={
                      chosenBlock === undefined ? 'Choose a block first' : 'Choose your flat'
                    }
                    disabled={chosenBlock === undefined}
                    onChange={(event) => {
                      update({ unitId: event.target.value });
                    }}
                    onBlur={() => {
                      blur('unit');
                    }}
                    options={(chosenBlock?.units ?? []).map((unit) => ({
                      value: String(unit.unitId),
                      label: unit.label,
                    }))}
                  />
                </Field>
                <Button
                  variant="ghost"
                  onClick={() => {
                    update({ claiming: true });
                  }}
                >
                  My flat is not on the list
                </Button>
              </>
            )}
          </section>
        ) : null}

        {/* ------------------------------------------------------------ step 2: about you */}
        {draft.step === 1 ? (
          <section className="mt-6 flex flex-col gap-4">
            <h2 className="type-title">About you</h2>
            <Field label="Full name" required error={showing('name')}>
              <Input
                value={draft.name}
                onChange={(event) => {
                  update({ name: event.target.value });
                }}
                onBlur={() => {
                  blur('name');
                }}
                autoComplete="name"
              />
            </Field>
            <Field
              label="Mobile number"
              required
              error={showing('phone')}
              hint="A 10-digit Indian mobile number. The gate calls this when your visitor arrives."
            >
              <Input
                type="tel"
                inputMode="numeric"
                value={draft.phone}
                onChange={(event) => {
                  update({ phone: event.target.value });
                }}
                onBlur={() => {
                  blur('phone');
                }}
                autoComplete="tel-national"
                leading={<Icon name="phone" size={16} />}
                trailing={
                  /^(?:\+91)?[6-9]\d{9}$/.test(phoneDigits) ? (
                    <Icon name="check" size={16} className="text-positive" />
                  ) : undefined
                }
              />
            </Field>
            <Field
              label="Email"
              required
              error={showing('email')}
              hint="This is how the committee reaches you about your application."
            >
              <Input
                type="email"
                inputMode="email"
                value={draft.email}
                onChange={(event) => {
                  update({ email: event.target.value });
                }}
                onBlur={() => {
                  blur('email');
                }}
                autoComplete="email"
              />
            </Field>
          </section>
        ) : null}

        {/* ------------------------------------------------------------ step 3: password */}
        {draft.step === 2 ? (
          <section className="mt-6 flex flex-col gap-4">
            <h2 className="type-title">Choose a password</h2>
            <Field
              label="Password"
              required
              error={showing('password')}
              hint="At least 10 characters, with upper and lower case, and a number or a symbol."
            >
              <Input
                type="password"
                value={draft.password}
                onChange={(event) => {
                  update({ password: event.target.value });
                }}
                onBlur={() => {
                  blur('password');
                }}
                autoComplete="new-password"
              />
            </Field>
            {draft.password.length > 0 ? (
              <div aria-live="polite">
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((bar) => (
                    <span
                      key={`strength-${bar}`}
                      className={
                        passwordVerdict(draft.password).score > bar
                          ? 'h-1.5 flex-1 rounded-pill bg-accent'
                          : 'h-1.5 flex-1 rounded-pill bg-surface-sunken'
                      }
                    />
                  ))}
                </div>
                <p className="mt-1 type-label text-content-subtle">
                  {STRENGTH_LABEL[passwordVerdict(draft.password).score]}
                </p>
              </div>
            ) : null}
            <Field label="Confirm password" required error={showing('confirmPassword')}>
              <Input
                type="password"
                value={draft.confirmPassword}
                onChange={(event) => {
                  update({ confirmPassword: event.target.value });
                }}
                onBlur={() => {
                  blur('confirmPassword');
                }}
                autoComplete="new-password"
              />
            </Field>
          </section>
        ) : null}

        {/* ------------------------------------------------------------ step 4: review */}
        {draft.step === 3 ? (
          <section className="mt-6 flex flex-col gap-4">
            <h2 className="type-title">Check everything</h2>
            <p className="type-body text-content-muted">Each line is editable — nothing is sent until you submit.</p>
            <ReviewRow label="Home" onEdit={() => { goTo(0); }}>
              {draft.claiming
                ? `${draft.claimBlock.trim()}, ${draft.claimUnit.trim()} — ${C.UNIT_TYPE[draft.claimType as C.UnitType]?.label ?? 'as described'}`
                : chosenBlock !== undefined
                  ? `${chosenBlock.blockName}, ${chosenBlock.units.find((unit) => String(unit.unitId) === draft.unitId)?.label ?? ''}`
                  : 'Your flat'}
            </ReviewRow>
            <ReviewRow label="Name" onEdit={() => { goTo(1); }}>{draft.name.trim()}</ReviewRow>
            <ReviewRow label="Mobile" onEdit={() => { goTo(1); }}>{draft.phone}</ReviewRow>
            <ReviewRow label="Email" onEdit={() => { goTo(1); }}>{draft.email.trim()}</ReviewRow>
            {serverError !== null && serverField === null ? (
              <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
                {serverError}
              </p>
            ) : null}
            <Button size="lg" fullWidth pending={submitting} pendingLabel="Submitting" onClick={() => { void submit(); }}>
              Submit application
            </Button>
            <p className="type-label text-content-subtle">
              By submitting you confirm these details are yours. The committee reviews applications
              daily; you will get an email either way.
            </p>
          </section>
        ) : null}
      </div>

      {draft.step < 3 ? (
        <div className="mt-6 flex gap-3">
          {draft.step > 0 ? (
            <Button variant="secondary" size="lg" onClick={() => { goTo(draft.step - 1); }}>
              Back
            </Button>
          ) : null}
          <Button size="lg" fullWidth={draft.step === 0} onClick={next}>
            Continue
          </Button>
        </div>
      ) : null}
    </main>
  );
}

function ReviewRow({
  label,
  children,
  onEdit,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly onEdit: () => void;
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
      <div className="min-w-0">
        <p className="type-label text-content-subtle">{label}</p>
        <p className="type-body break-words">{children}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${label}`}>
        Edit
      </Button>
    </div>
  );
}
