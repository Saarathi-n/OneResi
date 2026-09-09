'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Logo,
  Select,
  Stepper,
  Textarea,
  ProgressRing,
} from '@oneresi/ui';
import {
  Email,
  Password,
  PersonName,
  Phone,
  UnitLabel,
  UNIT_TYPES,
  UNIT_TYPE,
  type UnitType,
} from '@oneresi/contracts';
import { call } from '@/lib/session';

/**
 * Registration in four steps (04-product-design.md "Progress"):
 *   1 Your home — pick the block and unit, or describe a home not on the list (D-04)
 *   2 About you — name, phone, email
 *   3 Password — policy from the shared Zod schema, so client and server cannot disagree (D-71)
 *   4 Review — everything shown back, each line editable, then submit
 *
 * The draft persists to localStorage on every change and is restored with a note. Validation is
 * per-field on blur, never on keystroke; one summary appears only after a failed submit.
 */

const DRAFT_KEY = 'oneresi.registration.draft';
const STEPS = [
  { id: 'home', label: 'Your home', hint: 'Where you live in the society' },
  { id: 'you', label: 'About you', hint: 'Name and contact details' },
  { id: 'password', label: 'Password', hint: 'Choose one you have not used everywhere' },
  { id: 'review', label: 'Review', hint: 'Check everything before you submit' },
] as const;

interface RegistrationOptionsBlock {
  blockId: number;
  blockName: string;
  units: { unitId: number; label: string }[];
}

interface Draft {
  homeKind: 'existing' | 'claim';
  blockId: string;
  unitId: string;
  claimBlockName: string;
  claimUnitLabel: string;
  claimUnitType: string;
  claimNote: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  passwordConfirm: string;
}

const EMPTY_DRAFT: Draft = {
  homeKind: 'existing',
  blockId: '',
  unitId: '',
  claimBlockName: '',
  claimUnitLabel: '',
  claimUnitType: '',
  claimNote: '',
  name: '',
  phone: '',
  email: '',
  password: '',
  passwordConfirm: '',
};

type FieldErrors = Partial<Record<keyof Draft, string>>;

function loadDraft(): { draft: Draft; restored: boolean } {
  if (typeof window === 'undefined') return { draft: EMPTY_DRAFT, restored: false };
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw === null) return { draft: EMPTY_DRAFT, restored: false };
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return { draft: { ...EMPTY_DRAFT, ...parsed }, restored: true };
  } catch {
    return { draft: EMPTY_DRAFT, restored: false };
  }
}

function saveDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A full or blocked localStorage must not break the form; the draft is a convenience.
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Same rule as above.
  }
}

/** First error message from a Zod parse, for the one field the blur just left. */
function fieldError(schema: { safeParse: (v: string) => { success: boolean; error?: { issues: { message: string }[] } } }, value: string): string | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  return result.error?.issues[0]?.message ?? 'Check this field.';
}

/** Password strength as a 0-4 score: length, cases, digit/symbol, not-common. */
function passwordScore(value: string): number {
  let score = 0;
  if (value.length >= 10) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
  if (!/^(?:password|oneresi|qwerty|12345)/i.test(value)) score += 1;
  return score;
}

const STRENGTH_WORDS = ['Too simple', 'Getting there', 'Fair', 'Good', 'Strong'];

export default function RegisterPage() {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<RegistrationOptionsBlock[] | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const loaded = loadDraft();
    setDraft(loaded.draft);
    setRestored(loaded.restored);
    void (async () => {
      const result = await call<RegistrationOptionsBlock[]>('/api/registration/options');
      if (result.ok) {
        setOptions(result.data);
      } else {
        setOptionsFailed(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (step < 4) saveDraft(draft);
  }, [draft, step]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (previous[key] === undefined) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  /** Per-field validation on blur, never on keystroke. */
  function validateOnBlur(key: keyof Draft): void {
    let message: string | null = null;
    switch (key) {
      case 'name':
        message = fieldError(PersonName, draft.name);
        break;
      case 'email':
        message = fieldError(Email, draft.email);
        break;
      case 'phone':
        message = fieldError(Phone, draft.phone);
        break;
      case 'password':
        message = fieldError(Password, draft.password);
        break;
      case 'passwordConfirm':
        message = draft.passwordConfirm === draft.password ? null : 'The two passwords do not match.';
        break;
      case 'claimBlockName':
        message =
          draft.homeKind === 'claim' && draft.claimBlockName.trim().length === 0
            ? 'Enter the block or building name.'
            : null;
        break;
      case 'claimUnitLabel':
        if (draft.homeKind === 'claim') {
          const parsed = UnitLabel.safeParse(draft.claimUnitLabel);
          message = parsed.success ? null : (parsed.error?.issues[0]?.message ?? 'Enter your flat number.');
        }
        break;
      default:
        break;
    }
    setErrors((previous) => {
      const next = { ...previous };
      if (message === null) delete next[key];
      else next[key] = message;
      return next;
    });
  }

  const unitOptions = useMemo(() => {
    const block = options?.find((b) => String(b.blockId) === draft.blockId);
    return (
      block?.units.map((unit) => ({
        value: String(unit.unitId),
        label: unit.label,
      })) ?? []
    );
  }, [options, draft.blockId]);

  const selectedBlock = options?.find((b) => String(b.blockId) === draft.blockId);
  const selectedUnit = unitOptions.find((u) => u.value === draft.unitId);
  const selectedUnitType: UnitType | null =
    draft.claimUnitType === '' ? null : (draft.claimUnitType as UnitType);

  function validateStep(index: number): boolean {
    const next: FieldErrors = {};
    if (index === 0) {
      if (draft.homeKind === 'existing') {
        if (draft.blockId === '') next.blockId = 'Choose your block.';
        if (draft.unitId === '') next.unitId = 'Choose your flat.';
      } else {
        if (draft.claimBlockName.trim().length === 0) next.claimBlockName = 'Enter the block or building name.';
        const parsed = UnitLabel.safeParse(draft.claimUnitLabel);
        if (!parsed.success) next.claimUnitLabel = parsed.error?.issues[0]?.message ?? 'Enter your flat number.';
        if (draft.claimUnitType === '') next.claimUnitType = 'Choose the kind of home.';
      }
    }
    if (index === 1) {
      const name = PersonName.safeParse(draft.name);
      if (!name.success) next.name = name.error?.issues[0]?.message ?? 'Enter your full name.';
      const email = Email.safeParse(draft.email);
      if (!email.success) next.email = email.error?.issues[0]?.message ?? 'Enter a valid email address.';
      const phone = Phone.safeParse(draft.phone);
      if (!phone.success) next.phone = phone.error?.issues[0]?.message ?? 'Enter a 10-digit Indian mobile number.';
    }
    if (index === 2) {
      const policy = Password.safeParse(draft.password);
      if (!policy.success) next.password = policy.error?.issues[0]?.message ?? 'Choose a stronger password.';
      if (draft.passwordConfirm !== draft.password) next.passwordConfirm = 'The two passwords do not match.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goForward(): void {
    if (!validateStep(step)) {
      setSummary('One or more answers need attention before you continue.');
      return;
    }
    setSummary(null);
    setStep((s) => Math.min(s + 1, 3));
  }

  async function handleSubmit(): Promise<void> {
    for (let index = 0; index <= 2; index += 1) {
      if (!validateStep(index)) {
        setStep(index);
        setSummary('One or more answers need attention before you submit.');
        return;
      }
    }
    if (draft.password !== draft.passwordConfirm) {
      setStep(2);
      setSummary('The two passwords do not match.');
      return;
    }
    setPending(true);
    setSummary(null);

    const body =
      draft.homeKind === 'existing'
        ? {
            name: draft.name,
            email: draft.email,
            phone: draft.phone,
            password: draft.password,
            home: { kind: 'existing', unitId: Number(draft.unitId) },
          }
        : {
            name: draft.name,
            email: draft.email,
            phone: draft.phone,
            password: draft.password,
            home: {
              kind: 'claim',
              blockName: draft.claimBlockName.trim(),
              unitLabel: draft.claimUnitLabel.trim(),
              unitType: selectedUnitType ?? 'FLAT_2BHK',
              ...(draft.claimNote.trim().length === 0 ? {} : { note: draft.claimNote.trim() }),
            },
          };

    const result = await call<{ personId: number }>('/api/auth/register', {
      method: 'POST',
      json: body,
    });
    setPending(false);
    if (result.ok) {
      clearDraft();
      setStep(4);
      setSubmitted(true);
      return;
    }
    setSummary(result.error.message);
    const field = result.error.field;
    if (field !== undefined) {
      if (field === 'email') setStep(1);
      if (field === 'password') setStep(2);
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface">
        <header className="border-b border-border bg-surface-raised">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" aria-label="OneResi home">
              <Logo variant="wordmark" size={28} />
            </Link>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <ProgressRing value={100} label="Application submitted" tone="positive" size={72} />
          <h1 className="type-title mt-6 text-content">Your application is in</h1>
          <p className="type-body mt-3 text-content-muted">
            The committee reviews applications daily, and you will get an email either way —
            usually within a day or two. Once approved, sign in with the email and password you
            just chose.
          </p>
          <Link href="/sign-in" className="mt-8">
            <Button size="lg">Go to sign in</Button>
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="OneResi home">
            <Logo variant="wordmark" size={28} />
          </Link>
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">
              I already have an account
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="type-title text-content">Join your society</h1>
        <p className="type-body mt-2 text-content-muted">
          Four short steps. Your answers save as you go, so closing this tab costs you nothing.
        </p>

        <div className="mt-8">
          <Stepper
            steps={STEPS}
            current={step}
            onStepSelect={(index) => {
              if (index < step) setStep(index);
            }}
          />
        </div>

        {restored ? (
          <p className="type-body mt-4 rounded-lg bg-accent-soft px-4 py-3 text-content">
            Picking up where you left off — your earlier answers are already filled in.
          </p>
        ) : null}

        {summary !== null ? (
          <p className="type-body mt-4 rounded-lg bg-critical-soft px-4 py-3 text-critical" role="alert">
            {summary}
          </p>
        ) : null}

        <Card className="mt-6" elevation={1}>
          <CardBody>
            {step === 0 ? (
              <div className="space-y-5">
                <Field label="Is your home on the list?" required as="group">
                  <div className="flex gap-2">
                    <Button
                      variant={draft.homeKind === 'existing' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => update('homeKind', 'existing')}
                      type="button"
                    >
                      Choose from the list
                    </Button>
                    <Button
                      variant={draft.homeKind === 'claim' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => update('homeKind', 'claim')}
                      type="button"
                    >
                      Mine is not listed
                    </Button>
                  </div>
                </Field>

                {draft.homeKind === 'existing' ? (
                  options === null && !optionsFailed ? (
                    <Field label="Block" pending hint="Loading the society's blocks…">
                      <Select options={[]} placeholder="Loading…" pending />
                    </Field>
                  ) : optionsFailed ? (
                    <p className="type-body text-critical">
                      We could not load the society&apos;s blocks. Refresh the page to try again.
                    </p>
                  ) : (
                    <>
                      <Field
                        label="Block"
                        required
                        error={errors.blockId}
                        hint="The building or wing your flat is in."
                      >
                        <Select
                          options={(options ?? []).map((block) => ({
                            value: String(block.blockId),
                            label: block.blockName,
                          }))}
                          placeholder="Choose a block"
                          value={draft.blockId}
                          onChange={(event) => {
                            update('blockId', event.target.value);
                            update('unitId', '');
                          }}
                        />
                      </Field>
                      <Field label="Flat" required error={errors.unitId}>
                        <Select
                          options={unitOptions}
                          placeholder={
                            draft.blockId === '' ? 'Choose a block first' : 'Choose your flat'
                          }
                          value={draft.unitId}
                          disabled={draft.blockId === ''}
                          onChange={(event) => update('unitId', event.target.value)}
                        />
                      </Field>
                    </>
                  )
                ) : (
                  <>
                    <Field
                      label="Block or building name"
                      required
                      error={errors.claimBlockName}
                      hint="As you know it — the committee matches it to their records."
                    >
                      <Input
                        value={draft.claimBlockName}
                        autoComplete="address-line1"
                        onBlur={() => validateOnBlur('claimBlockName')}
                        onChange={(event) => update('claimBlockName', event.target.value)}
                      />
                    </Field>
                    <Field label="Flat or plot number" required error={errors.claimUnitLabel}>
                      <Input
                        value={draft.claimUnitLabel}
                        autoComplete="address-line2"
                        onBlur={() => validateOnBlur('claimUnitLabel')}
                        onChange={(event) => update('claimUnitLabel', event.target.value)}
                      />
                    </Field>
                    <Field label="Kind of home" required error={errors.claimUnitType}>
                      <Select
                        options={UNIT_TYPES.map((type) => ({
                          value: type,
                          label: UNIT_TYPE[type].label,
                        }))}
                        placeholder="Choose the kind"
                        value={draft.claimUnitType}
                        onChange={(event) => update('claimUnitType', event.target.value)}
                      />
                    </Field>
                    <Field
                      label="Anything the committee should know"
                      optional
                      hint="Optional — a landmark, the floor, who you are in touch with."
                    >
                      <Textarea
                        rows={3}
                        value={draft.claimNote}
                        onChange={(event) => update('claimNote', event.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-5">
                <Field label="Full name" required error={errors.name}>
                  <Input
                    value={draft.name}
                    autoComplete="name"
                    onBlur={() => validateOnBlur('name')}
                    onChange={(event) => update('name', event.target.value)}
                  />
                </Field>
                <Field
                  label="Mobile number"
                  required
                  error={errors.phone}
                  hint="Ten digits, starting 6 to 9. The country code is optional."
                >
                  <Input
                    value={draft.phone}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    leading={<span aria-hidden="true">+91</span>}
                    onBlur={() => validateOnBlur('phone')}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </Field>
                <Field
                  label="Email"
                  required
                  error={errors.email}
                  hint="This becomes your sign-in, and where the committee's decision is sent."
                >
                  <Input
                    value={draft.email}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    onBlur={() => validateOnBlur('email')}
                    onChange={(event) => update('email', event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5">
                <Field
                  label="Password"
                  required
                  error={errors.password}
                  hint="At least 10 characters, with upper and lower case, and a number or symbol."
                >
                  <Input
                    value={draft.password}
                    type="password"
                    autoComplete="new-password"
                    onBlur={() => validateOnBlur('password')}
                    onChange={(event) => update('password', event.target.value)}
                  />
                </Field>
                {draft.password.length > 0 ? (
                  <div className="flex items-center gap-3">
                    <ProgressRing
                      value={passwordScore(draft.password)}
                      max={4}
                      label={`Password strength: ${STRENGTH_WORDS[passwordScore(draft.password)] ?? ''}`}
                      size={20}
                      tone={passwordScore(draft.password) >= 3 ? 'positive' : 'neutral'}
                    />
                    <p className="type-label text-content-muted">
                      {STRENGTH_WORDS[passwordScore(draft.password)] ?? ''}
                    </p>
                  </div>
                ) : null}
                <Field
                  label="Confirm password"
                  required
                  error={errors.passwordConfirm}
                >
                  <Input
                    value={draft.passwordConfirm}
                    type="password"
                    autoComplete="new-password"
                    onBlur={() => validateOnBlur('passwordConfirm')}
                    onChange={(event) => update('passwordConfirm', event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-2">
                <p className="type-label text-content-subtle uppercase tracking-wide">Your home</p>
                {draft.homeKind === 'existing' ? (
                  <ReviewLine
                    label="Home"
                    value={
                      selectedBlock !== undefined && selectedUnit !== undefined
                        ? `${selectedBlock.blockName} · ${selectedUnit.label}`
                        : '—'
                    }
                    onEdit={() => setStep(0)}
                  />
                ) : (
                  <>
                    <ReviewLine
                      label="Described home"
                      value={`${draft.claimBlockName} · ${draft.claimUnitLabel}`}
                      onEdit={() => setStep(0)}
                    />
                    {selectedUnitType !== null ? (
                      <ReviewLine
                        label="Kind"
                        value={UNIT_TYPE[selectedUnitType].label}
                        onEdit={() => setStep(0)}
                      />
                    ) : null}
                    {draft.claimNote.trim().length > 0 ? (
                      <ReviewLine label="Note" value={draft.claimNote} onEdit={() => setStep(0)} />
                    ) : null}
                  </>
                )}

                <p className="type-label mt-6 text-content-subtle uppercase tracking-wide">
                  About you
                </p>
                <ReviewLine label="Name" value={draft.name} onEdit={() => setStep(1)} />
                <ReviewLine label="Mobile" value={draft.phone} onEdit={() => setStep(1)} />
                <ReviewLine label="Email" value={draft.email} onEdit={() => setStep(1)} />

                <p className="type-label mt-6 text-content-subtle uppercase tracking-wide">
                  Sign-in
                </p>
                <ReviewLine label="Password" value="••••••••••" onEdit={() => setStep(2)} />

                <p className="type-body mt-6 text-content-muted">
                  By submitting you confirm these details are yours. The committee sees exactly
                  what you entered above.
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button onClick={goForward}>Continue</Button>
          ) : (
            <Button onClick={() => void handleSubmit()} pending={pending}>
              Submit application
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

function ReviewLine({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3">
      <div className="min-w-0">
        <p className="type-label text-content-subtle">{label}</p>
        <p className="type-body truncate text-content">{value}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}
