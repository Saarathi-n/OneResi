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
  ProgressRing,
  Select,
  Stepper,
  Textarea,
  buttonClass,
  cn,
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
import { Icon } from '@/components/icons';
import { call } from '@/lib/session';

/**
 * Registration wizard — "the apartment keys handover".
 *
 * 4-step progress tracking:
 *   1 Your home — paper selection cards: choose from society register or unlisted claim
 *   2 About you — generous input fields with clear helper guidance
 *   3 Sign-in key — real-time password strength progress ring with descriptive status words
 *   4 Review & handover — authentic definition receipt docket with inline edit pills
 *
 * Celebratory completion screen with 100% green progress ring and reassuring timeline.
 * Draft persistence in localStorage preserved (passwords excluded).
 */

const DRAFT_KEY = 'oneresi.registration.draft';

const STEPS = [
  { id: 'home', label: 'Your home', hint: 'Select or describe your residence in the society' },
  { id: 'you', label: 'About you', hint: 'Your full name and verified contact details' },
  { id: 'password', label: 'Sign-in key', hint: 'Choose a strong password for your account' },
  { id: 'review', label: 'Review & handover', hint: 'Verify all details before committee dispatch' },
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
    // Passwords never reach persistent storage
    const { password: _password, passwordConfirm: _passwordConfirm, ...rest } = draft;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
  } catch {
    // Graceful fallback if storage is restricted
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Graceful fallback
  }
}

/** First error message from a Zod parse for the field just blurred. */
function fieldError(
  schema: { safeParse: (v: string) => { success: boolean; error?: { issues: { message: string }[] } } },
  value: string,
): string | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  return result.error?.issues[0]?.message ?? 'Check this field.';
}

/** Password strength score 0 to 4 */
function passwordScore(value: string): number {
  let score = 0;
  if (value.length >= 10) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
  if (!/^(?:password|oneresi|qwerty|12345)/i.test(value)) score += 1;
  return score;
}

const STRENGTH_WORDS = ['Too simple', 'Getting there', 'Fair', 'Good', 'Strong'] as const;

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
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

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

  function handleClearDraft(): void {
    clearDraft();
    setDraft(EMPTY_DRAFT);
    setRestored(false);
    setStep(0);
    setErrors({});
    setSummary(null);
  }

  /** Per-field validation on blur, never on keystroke */
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

  // Password Strength calculations for Step 3
  const score = passwordScore(draft.password);
  const strengthWord = STRENGTH_WORDS[score] ?? 'Too simple';
  const strengthTone =
    score >= 4
      ? ('positive' as const)
      : score >= 3
        ? undefined
        : score >= 1
          ? ('caution' as const)
          : ('critical' as const);

  // Celebratory completion screen
  if (submitted) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface">
        <header className="border-b border-border bg-surface-raised">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" aria-label="OneResi home" className="focus-ring rounded-pill">
              <Logo variant="wordmark" size={28} />
            </Link>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="relative flex items-center justify-center">
            <ProgressRing
              value={100}
              max={100}
              label="Application submitted"
              tone="positive"
              size={88}
              thickness={7}
            >
              <Icon name="check" size={36} className="text-positive" />
            </ProgressRing>
          </div>

          <div className="mt-6">
            <span className="stamp text-positive text-xs tracking-widest">SUBMITTED</span>
          </div>

          <h1 className="type-title text-content mt-4 text-2xl md:text-3xl font-semibold">
            Your application is with the committee
          </h1>

          <p className="type-body mt-3 text-content-muted max-w-md mx-auto">
            The committee reviews applications daily, and you will get an email either way — usually
            within a day or two. Once approved, sign in with the email and password you just chose.
          </p>

          {/* Reassuring Next-step Timeline Docket */}
          <div className="mt-8 w-full text-left rounded-2xl border border-border bg-surface-raised p-6 shadow-e1">
            <h2 className="type-label uppercase tracking-wider text-content-subtle font-semibold mb-4">
              What happens next
            </h2>
            <ol className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive">
                  <Icon name="check" size={14} />
                </div>
                <div>
                  <p className="type-body text-sm font-semibold text-content">
                    Application logged in register
                  </p>
                  <p className="type-micro text-content-muted">
                    Your details and flat allocation request are securely recorded.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-caution-soft text-caution font-mono text-xs font-bold">
                  2
                </div>
                <div>
                  <p className="type-body text-sm font-semibold text-content">
                    Society committee verification
                  </p>
                  <p className="type-micro text-content-muted">
                    The estate secretary verifies your resident occupancy against society records.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-content-subtle font-mono text-xs">
                  3
                </div>
                <div>
                  <p className="type-body text-sm font-semibold text-content">
                    Handover completed & portal access
                  </p>
                  <p className="type-micro text-content-muted">
                    You will receive an email confirmation with immediate resident sign-in access.
                  </p>
                </div>
              </li>
            </ol>
          </div>

          <Link href="/sign-in" className={buttonClass('primary', 'lg', 'mt-8 rounded-pill shadow-e1 px-8')}>
            Go to sign in
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {/* Top Navigation */}
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="OneResi home" className="focus-ring rounded-pill">
            <Logo variant="wordmark" size={28} />
          </Link>
          <div className="flex items-center gap-3">
            <span className="type-body text-content-muted hidden sm:inline">Already registered?</span>
            <Link href="/sign-in" className={buttonClass('ghost', 'sm', 'rounded-pill')}>
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-6 py-8 md:py-12">
        {/* Handover Badge & Heading */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-accent-soft text-accent text-xs font-semibold mb-3 border border-accent-border/50">
            <Icon name="key" size={14} />
            <span>Apartment Keys Handover</span>
          </div>
          <h1 className="type-title text-content text-2xl md:text-3xl font-semibold">
            Join your society
          </h1>
          <p className="type-body mt-1 text-content-muted">
            Four short steps to your resident portal. Your answers save as you go, so closing this tab
            costs you nothing.
          </p>
        </div>

        {/* 4-Step Progress Stepper */}
        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-e1">
          <Stepper
            steps={STEPS}
            current={step}
            onStepSelect={(index) => {
              if (index < step) setStep(index);
            }}
          />
        </div>

        {/* Restored Draft Banner */}
        {restored ? (
          <div className="mt-4 rounded-xl bg-accent-soft border border-accent-border/60 px-4 py-3 text-content flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Icon name="sparkle" size={16} className="text-accent shrink-0" />
              <p className="type-body text-sm font-medium">
                Picking up where you left off — earlier answers restored.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearDraft}
              className="type-micro font-semibold text-content-subtle hover:text-critical underline cursor-pointer"
            >
              Start fresh
            </button>
          </div>
        ) : null}

        {/* Global Summary Error */}
        {summary !== null ? (
          <div
            className="mt-4 rounded-xl bg-critical-soft border border-critical-border px-4 py-3 text-critical flex items-center gap-2"
            role="alert"
          >
            <span className="h-2 w-2 rounded-full bg-critical shrink-0" />
            <p className="type-body text-sm font-medium">{summary}</p>
          </div>
        ) : null}

        {/* Form Card */}
        <Card className="mt-6 rounded-2xl md:rounded-3xl border border-border shadow-e2" elevation={1}>
          <CardBody className="p-6 sm:p-8">
            {/* STEP 1: YOUR HOME */}
            {step === 0 ? (
              <div className="space-y-6">
                <div>
                  <h2 className="type-title text-content text-lg font-semibold">
                    Select your residence
                  </h2>
                  <p className="type-body text-sm text-content-muted mt-0.5">
                    Choose your registered flat or describe your unit if newly handed over.
                  </p>
                </div>

                {/* Paper-styled Selection Cards with smooth toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <button
                    type="button"
                    onClick={() => update('homeKind', 'existing')}
                    className={cn(
                      'text-left p-4 rounded-2xl border transition-all cursor-pointer focus-ring flex flex-col justify-between relative',
                      draft.homeKind === 'existing'
                        ? 'border-accent bg-accent-soft/40 shadow-e1 ring-1 ring-accent'
                        : 'border-border bg-surface-raised hover:bg-surface text-content',
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-accent border border-border">
                        <Icon name="building" size={18} />
                      </div>
                      <span
                        className={cn(
                          'h-4 w-4 rounded-full border flex items-center justify-center',
                          draft.homeKind === 'existing'
                            ? 'border-accent bg-accent text-white'
                            : 'border-border-strong',
                        )}
                      >
                        {draft.homeKind === 'existing' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    </div>
                    <div>
                      <p className="type-body font-semibold text-content">Choose from the list</p>
                      <p className="type-micro text-content-muted mt-0.5">
                        Select from existing blocks and flats in society records.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => update('homeKind', 'claim')}
                    className={cn(
                      'text-left p-4 rounded-2xl border transition-all cursor-pointer focus-ring flex flex-col justify-between relative',
                      draft.homeKind === 'claim'
                        ? 'border-accent bg-accent-soft/40 shadow-e1 ring-1 ring-accent'
                        : 'border-border bg-surface-raised hover:bg-surface text-content',
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-accent border border-border">
                        <Icon name="key" size={18} />
                      </div>
                      <span
                        className={cn(
                          'h-4 w-4 rounded-full border flex items-center justify-center',
                          draft.homeKind === 'claim'
                            ? 'border-accent bg-accent text-white'
                            : 'border-border-strong',
                        )}
                      >
                        {draft.homeKind === 'claim' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    </div>
                    <div>
                      <p className="type-body font-semibold text-content">Mine is not listed</p>
                      <p className="type-micro text-content-muted mt-0.5">
                        Describe your flat or villa for committee verification.
                      </p>
                    </div>
                  </button>
                </div>

                {/* Sub-path: Existing Listed Units */}
                {draft.homeKind === 'existing' ? (
                  options === null && !optionsFailed ? (
                    <Field label="Block" pending hint="Loading the society register…">
                      <Select options={[]} placeholder="Loading blocks…" pending />
                    </Field>
                  ) : optionsFailed ? (
                    <div className="rounded-xl bg-critical-soft p-4 text-critical border border-critical-border">
                      <p className="type-body text-sm">
                        We could not load the society blocks. Refresh the page to try again.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5 pt-2 border-t border-border">
                      {/* Large tappable chips for Block selection */}
                      <div className="space-y-2">
                        <label className="type-label text-content font-medium">
                          Building or Block <span className="text-critical">*</span>
                        </label>
                        {options && options.length > 0 ? (
                          <div className="flex flex-wrap gap-2.5">
                            {options.map((block) => {
                              const isSelected = draft.blockId === String(block.blockId);
                              return (
                                <button
                                  type="button"
                                  key={block.blockId}
                                  onClick={() => {
                                    update('blockId', String(block.blockId));
                                    update('unitId', '');
                                  }}
                                  className={cn(
                                    'px-4 py-2.5 rounded-xl border text-sm font-medium transition-all cursor-pointer focus-ring flex items-center gap-2',
                                    isSelected
                                      ? 'border-accent bg-accent text-white shadow-e1 font-semibold'
                                      : 'border-border bg-surface-raised hover:bg-surface text-content',
                                  )}
                                >
                                  <Icon
                                    name="building"
                                    size={16}
                                    className={isSelected ? 'text-white' : 'text-content-subtle'}
                                  />
                                  <span>{block.blockName}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <Select
                            options={(options ?? []).map((b) => ({
                              value: String(b.blockId),
                              label: b.blockName,
                            }))}
                            placeholder="Choose a block"
                            value={draft.blockId}
                            onChange={(event) => {
                              update('blockId', event.target.value);
                              update('unitId', '');
                            }}
                          />
                        )}
                        {errors.blockId && (
                          <p className="type-label text-critical text-xs mt-1">{errors.blockId}</p>
                        )}
                      </div>

                      {/* Flat Selection */}
                      <div className="space-y-2">
                        <label className="type-label text-content font-medium">
                          Flat Number <span className="text-critical">*</span>
                        </label>
                        {draft.blockId === '' ? (
                          <p className="type-micro text-content-subtle italic">
                            Select a block above to view available flats.
                          </p>
                        ) : unitOptions.length > 0 && unitOptions.length <= 20 ? (
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
                            {unitOptions.map((unit) => {
                              const isSelected = draft.unitId === unit.value;
                              return (
                                <button
                                  type="button"
                                  key={unit.value}
                                  onClick={() => update('unitId', unit.value)}
                                  className={cn(
                                    'px-3 py-2 rounded-xl border text-center font-mono text-sm transition-all cursor-pointer focus-ring',
                                    isSelected
                                      ? 'border-accent bg-accent text-white shadow-e1 font-semibold'
                                      : 'border-border bg-surface-raised hover:bg-surface text-content',
                                  )}
                                >
                                  {unit.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <Select
                            options={unitOptions}
                            placeholder={
                              draft.blockId === '' ? 'Choose a block first' : 'Choose your flat'
                            }
                            value={draft.unitId}
                            disabled={draft.blockId === ''}
                            onChange={(event) => update('unitId', event.target.value)}
                          />
                        )}
                        {errors.unitId && (
                          <p className="type-label text-critical text-xs mt-1">{errors.unitId}</p>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  /* Sub-path: Claimed / Unlisted Unit Form */
                  <div className="space-y-5 pt-2 border-t border-border">
                    <Field
                      label="Block or building name"
                      required
                      error={errors.claimBlockName}
                      hint="As you know it — the committee matches it to their records."
                    >
                      <Input
                        value={draft.claimBlockName}
                        autoComplete="address-line1"
                        placeholder="e.g. Tower B, Palm Court"
                        onBlur={() => validateOnBlur('claimBlockName')}
                        onChange={(event) => update('claimBlockName', event.target.value)}
                      />
                    </Field>

                    <Field
                      label="Flat or plot number"
                      required
                      error={errors.claimUnitLabel}
                      hint="As numbered on your door or rental agreement."
                    >
                      <Input
                        value={draft.claimUnitLabel}
                        autoComplete="address-line2"
                        placeholder="e.g. 402, Villa 15"
                        onBlur={() => validateOnBlur('claimUnitLabel')}
                        onChange={(event) => update('claimUnitLabel', event.target.value)}
                      />
                    </Field>

                    <Field
                      label="Kind of home"
                      required
                      error={errors.claimUnitType}
                      hint="Select unit layout type."
                    >
                      <Select
                        options={UNIT_TYPES.map((type) => ({
                          value: type,
                          label: UNIT_TYPE[type].label,
                        }))}
                        placeholder="Choose the kind of home"
                        value={draft.claimUnitType}
                        onChange={(event) => update('claimUnitType', event.target.value)}
                      />
                    </Field>

                    <Field
                      label="Anything the committee should know"
                      optional
                      hint="Optional — a landmark, floor, or previous occupant."
                    >
                      <Textarea
                        rows={3}
                        value={draft.claimNote}
                        placeholder="e.g. 4th floor corner flat, moved in this month."
                        onChange={(event) => update('claimNote', event.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>
            ) : null}

            {/* STEP 2: ABOUT YOU */}
            {step === 1 ? (
              <div className="space-y-6">
                <div>
                  <h2 className="type-title text-content text-lg font-semibold">
                    Personal Information
                  </h2>
                  <p className="type-body text-sm text-content-muted mt-0.5">
                    Your details are verified by society administrators to ensure secure community access.
                  </p>
                </div>

                <div className="space-y-5">
                  <Field
                    label="Full name"
                    required
                    error={errors.name}
                    hint="Your legal name as recorded with the society office or rental agreement."
                  >
                    <Input
                      value={draft.name}
                      autoComplete="name"
                      placeholder="e.g. Sunita Nair"
                      autoFocus
                      onBlur={() => validateOnBlur('name')}
                      onChange={(event) => update('name', event.target.value)}
                    />
                  </Field>

                  <Field
                    label="Mobile number"
                    required
                    error={errors.phone}
                    hint="Ten digits, starting 6 to 9. The gatekeeper and committee reach you on this number."
                  >
                    <Input
                      value={draft.phone}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="98765 43210"
                      leading={<span className="font-semibold text-content-subtle">+91</span>}
                      onBlur={() => validateOnBlur('phone')}
                      onChange={(event) => update('phone', event.target.value)}
                    />
                  </Field>

                  <Field
                    label="Email address"
                    required
                    error={errors.email}
                    hint="This becomes your sign-in, and where the committee's decision is sent."
                  >
                    <Input
                      value={draft.email}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="name@example.com"
                      onBlur={() => validateOnBlur('email')}
                      onChange={(event) => update('email', event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            {/* STEP 3: PASSWORD / SIGN-IN KEY */}
            {step === 2 ? (
              <div className="space-y-6">
                <div>
                  <h2 className="type-title text-content text-lg font-semibold">
                    Choose your sign-in key
                  </h2>
                  <p className="type-body text-sm text-content-muted mt-0.5">
                    Create a strong password to safeguard your home dues and gate passes.
                  </p>
                </div>

                <div className="space-y-5">
                  <Field
                    label="Password"
                    required
                    error={errors.password}
                    hint="At least 10 characters with upper & lower case, and a number or symbol."
                  >
                    <div className="relative flex items-center">
                      <Input
                        value={draft.password}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Create a password"
                        autoFocus
                        className="pr-12"
                        onBlur={() => validateOnBlur('password')}
                        onChange={(event) => update('password', event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="focus-ring absolute right-2.5 flex items-center justify-center p-2 rounded-pill text-content-subtle hover:text-content hover:bg-surface transition-colors cursor-pointer"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                      </button>
                    </div>
                  </Field>

                  {/* Real-time Password Strength Progress Ring & Tactile Words */}
                  <div className="rounded-2xl border border-border bg-surface p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <ProgressRing
                        value={score}
                        max={4}
                        label={`Password strength: ${strengthWord}`}
                        size={46}
                        thickness={5}
                        tone={strengthTone}
                      >
                        <span className="type-micro font-bold text-content tabular-nums">
                          {score}/4
                        </span>
                      </ProgressRing>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="type-label font-semibold text-content">
                            {draft.password.length === 0 ? 'Password strength' : strengthWord}
                          </span>
                        </div>
                        <p className="type-micro text-content-muted mt-0.5">
                          {score === 4
                            ? 'Excellent passphrase'
                            : score >= 2
                              ? 'Getting there — add numbers or symbols'
                              : 'Needs at least 10 mixed characters'}
                        </p>
                      </div>
                    </div>

                    {/* Criteria Check Chips */}
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-pill text-[11px] font-medium border transition-colors',
                          draft.password.length >= 10
                            ? 'bg-positive-soft border-positive-border text-positive'
                            : 'bg-surface-raised border-border text-content-subtle',
                        )}
                      >
                        10+ chars
                      </span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-pill text-[11px] font-medium border transition-colors',
                          /[a-z]/.test(draft.password) && /[A-Z]/.test(draft.password)
                            ? 'bg-positive-soft border-positive-border text-positive'
                            : 'bg-surface-raised border-border text-content-subtle',
                        )}
                      >
                        Mixed case
                      </span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-pill text-[11px] font-medium border transition-colors',
                          /\d/.test(draft.password) || /[^A-Za-z0-9]/.test(draft.password)
                            ? 'bg-positive-soft border-positive-border text-positive'
                            : 'bg-surface-raised border-border text-content-subtle',
                        )}
                      >
                        Number/symbol
                      </span>
                    </div>
                  </div>

                  <Field
                    label="Confirm password"
                    required
                    error={errors.passwordConfirm}
                    hint="Retype the same password to confirm."
                  >
                    <div className="relative flex items-center">
                      <Input
                        value={draft.passwordConfirm}
                        type={showPasswordConfirm ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Re-enter password"
                        className="pr-12"
                        onBlur={() => validateOnBlur('passwordConfirm')}
                        onChange={(event) => update('passwordConfirm', event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordConfirm((prev) => !prev)}
                        className="focus-ring absolute right-2.5 flex items-center justify-center p-2 rounded-pill text-content-subtle hover:text-content hover:bg-surface transition-colors cursor-pointer"
                        aria-label={showPasswordConfirm ? 'Hide password' : 'Show password'}
                        title={showPasswordConfirm ? 'Hide password' : 'Show password'}
                      >
                        <Icon name={showPasswordConfirm ? 'eye-off' : 'eye'} size={18} />
                      </button>
                    </div>
                  </Field>
                </div>
              </div>
            ) : null}

            {/* STEP 4: REVIEW & HANDOVER RECEIPT CARD */}
            {step === 3 ? (
              <div className="space-y-6">
                <div>
                  <h2 className="type-title text-content text-lg font-semibold">
                    Review your application
                  </h2>
                  <p className="type-body text-sm text-content-muted mt-0.5">
                    Check your details below. Each section can be modified before final dispatch to the
                    committee.
                  </p>
                </div>

                {/* Definition Receipt Docket */}
                <div className="rounded-2xl border border-border bg-surface-raised p-5 sm:p-6 shadow-e2 relative">
                  <div className="flex items-center justify-between pb-4 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Icon name="building" size={16} className="text-accent" />
                      <span className="type-micro uppercase tracking-widest text-content-subtle font-bold">
                        Society Handover Docket
                      </span>
                    </div>
                    <span className="stamp text-accent text-xs">REVIEW</span>
                  </div>

                  {/* Section 1: Home Details */}
                  <div className="py-4 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="type-label uppercase tracking-wide text-xs text-content-subtle font-semibold">
                        01 · Home Allocation
                      </span>
                      <button
                        type="button"
                        onClick={() => setStep(0)}
                        className="focus-ring px-3 py-1 rounded-pill bg-surface-sunken hover:bg-surface border border-border text-xs font-semibold text-content transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Icon name="edit" size={12} />
                        <span>Edit</span>
                      </button>
                    </div>

                    <div className="space-y-1.5 mt-2">
                      {draft.homeKind === 'existing' ? (
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-content-muted">Flat & Block:</span>
                          <span className="font-semibold text-content text-right">
                            {selectedBlock !== undefined && selectedUnit !== undefined
                              ? `${selectedBlock.blockName} · ${selectedUnit.label}`
                              : '—'}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-baseline justify-between text-sm">
                            <span className="text-content-muted">Claimed Residence:</span>
                            <span className="font-semibold text-content text-right">
                              {draft.claimBlockName} · {draft.claimUnitLabel}
                            </span>
                          </div>
                          {selectedUnitType !== null ? (
                            <div className="flex items-baseline justify-between text-sm">
                              <span className="text-content-muted">Layout Type:</span>
                              <span className="font-semibold text-content text-right">
                                {UNIT_TYPE[selectedUnitType].label}
                              </span>
                            </div>
                          ) : null}
                          {draft.claimNote.trim().length > 0 ? (
                            <div className="flex flex-col text-sm mt-1 bg-surface p-2.5 rounded-xl border border-border">
                              <span className="type-micro text-content-subtle mb-0.5">Note for committee:</span>
                              <span className="text-content italic">&ldquo;{draft.claimNote}&rdquo;</span>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Section 2: Applicant Details */}
                  <div className="py-4 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="type-label uppercase tracking-wide text-xs text-content-subtle font-semibold">
                        02 · Applicant Details
                      </span>
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="focus-ring px-3 py-1 rounded-pill bg-surface-sunken hover:bg-surface border border-border text-xs font-semibold text-content transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Icon name="edit" size={12} />
                        <span>Edit</span>
                      </button>
                    </div>

                    <div className="space-y-1.5 mt-2">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-content-muted">Name:</span>
                        <span className="font-semibold text-content text-right">{draft.name}</span>
                      </div>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-content-muted">Mobile:</span>
                        <span className="font-mono text-content text-right">+91 {draft.phone}</span>
                      </div>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-content-muted">Email:</span>
                        <span className="font-semibold text-content text-right">{draft.email}</span>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Credentials */}
                  <div className="pt-4 pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="type-label uppercase tracking-wide text-xs text-content-subtle font-semibold">
                        03 · Access Key
                      </span>
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="focus-ring px-3 py-1 rounded-pill bg-surface-sunken hover:bg-surface border border-border text-xs font-semibold text-content transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Icon name="edit" size={12} />
                        <span>Edit</span>
                      </button>
                    </div>

                    <div className="flex items-baseline justify-between text-sm mt-2">
                      <span className="text-content-muted">Password:</span>
                      <span className="font-mono text-content text-right">••••••••••</span>
                    </div>
                  </div>

                  {/* Perforated receipt tear line */}
                  <div className="tear-line my-6" style={{ '--tear-inset': '24px' } as React.CSSProperties} />

                  <p className="type-micro text-content-muted leading-relaxed">
                    By submitting you confirm these details are yours. The management committee
                    verifies all applications against residency records before issuing digital gate
                    keys and accounting records.
                  </p>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* Action Controls */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-pill"
          >
            Back
          </Button>

          {step < 3 ? (
            <Button onClick={goForward} className="rounded-pill shadow-e1 px-6">
              <span>Continue</span>
              <Icon name="arrow-right" size={16} className="ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={() => void handleSubmit()}
              pending={pending}
              pendingLabel="Submitting your application"
              className="rounded-pill shadow-e2 px-8"
              size="lg"
            >
              Submit application
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
