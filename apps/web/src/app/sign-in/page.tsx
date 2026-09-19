'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Button,
  Field,
  Input,
  Logo,
  buttonClass,
} from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { roleHome, signIn } from '@/lib/session';

/**
 * Sign in — "the gatehouse at dawn".
 *
 * Split card:
 * - Left: deep forest accent panel with wordmark large, architectural gate tone,
 *   and slowly crossfading real product truths.
 * - Right: warm paper form with generous pre-focused email field, reveal password toggle,
 *   inline field errors, full-width pill submit button, and quiet links below.
 */

/** The address used last time, so the second visit starts one field ahead. */
const EMAIL_KEY = 'grihaone.sign-in.email';

const PRODUCT_TRUTHS = [
  'Receipts people can verify.',
  'The gate log households can read.',
  'Maintenance accounted for down to the rupee.',
] as const;

const DEMO_ROLES = [
  {
    role: 'Resident',
    email: 'saarathin@gmail.com',
    detail: 'Flat A-101',
    emoji: '🏠',
  },
  {
    role: 'Gate Staff',
    email: 'ashvin.ks2024@vitstudent.ac.in',
    detail: 'Security Kiosk',
    emoji: '🛡️',
  },
  {
    role: 'Committee',
    email: 'ashvinksg@gmail.com',
    detail: 'Desk Admin',
    emoji: '📋',
  },
] as const;

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [remembered, setRemembered] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [quoteVisible, setQuoteVisible] = useState(true);

  useEffect(() => {
    try {
      const last = window.localStorage.getItem(EMAIL_KEY);
      if (last !== null && last !== '') {
        setEmail(last);
        setRemembered(true);
      }
    } catch {
      // A blocked localStorage just means typing the address again.
    }
    if (new URLSearchParams(window.location.search).get('reset') === 'done') {
      setPasswordChanged(true);
    }
  }, []);

  // Crossfade rotating product copy on the gatehouse accent panel
  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIndex((prev) => (prev + 1) % PRODUCT_TRUTHS.length);
        setQuoteVisible(true);
      }, 400);
    }, 4600);
    return () => clearInterval(interval);
  }, []);

  function handleAutofill(targetEmail: string): void {
    const pwd = 'starling-marble-97-QUAY';
    setEmail(targetEmail);
    setPassword(pwd);
    setFieldErrors({});
  }

  async function handleSubmit(): Promise<void> {
    setFieldErrors({});

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldErrors({ email: 'Enter your email address.' });
      return;
    }
    if (!password) {
      setFieldErrors({ password: 'Enter your password.' });
      return;
    }

    setPending(true);
    const result = await signIn(trimmedEmail, password);

    if (result.ok) {
      try {
        window.localStorage.setItem(EMAIL_KEY, trimmedEmail);
      } catch {
        // Remembering is a convenience, never a requirement.
      }
      setPending(false);
      setSuccess(true);

      // Brief physical weight pause for admission confirmation before routing
      setTimeout(() => {
        router.push(roleHome(result.data.role));
      }, 100);
      return;
    }

    setPending(false);
    // Display error inline under the password field (never loose alerts)
    setFieldErrors({ password: result.error.message });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {/* Top Navigation */}
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="GrihaOne home" className="focus-ring rounded-pill">
            <Logo variant="wordmark" size={28} />
          </Link>
          <div className="flex items-center gap-3">
            <span className="type-body text-content-muted hidden sm:inline">New here?</span>
            <Link href="/register" className={buttonClass('ghost', 'sm', 'rounded-pill')}>
              Register
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content: The Gatehouse Split Card */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 md:p-10">
        <div className="w-full max-w-4xl overflow-hidden rounded-2xl md:rounded-3xl border border-border bg-surface-raised shadow-e3 flex flex-col md:flex-row">
          {/* Left Panel: Deep Forest Accent Gatehouse Panel (desktop only) */}
          <div
            className="hidden md:flex md:w-5/12 lg:w-1/2 flex-col justify-between p-8 lg:p-12 relative overflow-hidden text-[var(--accent-on)]"
            style={{
              background: 'linear-gradient(165deg, var(--accent) 0%, var(--accent-pressed) 100%)',
            }}
          >
            {/* Edge light & subtle dawn accent glow */}
            <div
              className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
              style={{ background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)' }}
              aria-hidden
            />

            {/* Top Branding */}
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-white/10 backdrop-blur-xs text-white/90 text-xs font-medium border border-white/15">
                <Icon name="shield" size={14} />
                <span>The Gatehouse</span>
              </div>
              <div className="mt-8">
                <Logo variant="wordmark" size={34} tone="inherit" />
              </div>
              <p className="type-body text-white/80 mt-3 max-w-xs">
                One quiet, verifiable ledger for Indian gated communities.
              </p>
            </div>

            {/* Middle Rotating Product Truth */}
            <div className="relative z-10 my-8 py-6 border-y border-white/15">
              <div className="min-h-[4.5rem] flex flex-col justify-center">
                <p
                  className={`type-title text-white font-serif italic text-xl transition-opacity duration-400 ease-in-out ${
                    quoteVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
                  }`}
                >
                  &ldquo;{PRODUCT_TRUTHS[quoteIndex]}&rdquo;
                </p>
              </div>

              {/* Progress indicator dots */}
              <div className="flex items-center gap-2 mt-4" aria-hidden>
                {PRODUCT_TRUTHS.map((truth, idx) => (
                  <button
                    key={truth}
                    type="button"
                    onClick={() => {
                      setQuoteIndex(idx);
                      setQuoteVisible(true);
                    }}
                    className={`h-1.5 rounded-pill transition-all duration-300 focus-ring ${
                      idx === quoteIndex ? 'w-6 bg-white' : 'w-2 bg-white/30 hover:bg-white/50'
                    }`}
                    aria-label={`View truth ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Bottom Assurance */}
            <div className="relative z-10 flex items-center justify-between text-xs text-white/60">
              <span>Residents · Committee · Gate</span>
              <span>Encrypted</span>
            </div>
          </div>

          {/* Right Panel: Warm Paper Sign-In Form */}
          <div className="w-full md:w-7/12 lg:w-1/2 p-6 sm:p-8 md:p-10 lg:p-12 flex flex-col justify-between bg-surface-raised">
            <div>
              <div className="flex items-center justify-between">
                <h1 className="type-title text-content text-2xl">Sign in</h1>
                <span className="type-label text-content-subtle font-normal">Registered portal</span>
              </div>
              <p className="type-body mt-2 text-content-muted">
                Enter your email and password to enter your society.
              </p>

              {passwordChanged ? (
                <div className="mt-4 rounded-xl bg-positive-soft border border-positive-border px-4 py-3 text-positive flex items-center gap-2.5">
                  <Icon name="check" size={16} className="shrink-0" />
                  <p className="type-body text-sm font-medium">
                    Your password was changed. Sign in with the new one.
                  </p>
                </div>
              ) : null}

              <form
                className="mt-6 space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
                noValidate
              >
                <Field
                  label="Email"
                  required
                  error={fieldErrors.email}
                  hint={
                    remembered
                      ? 'We filled in the address you signed in with last time.'
                      : undefined
                  }
                >
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    autoFocus
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (fieldErrors.email) {
                        setFieldErrors((prev) => ({ ...prev, email: null }));
                      }
                    }}
                    required
                    placeholder="name@example.com"
                  />
                </Field>

                <Field label="Password" required error={fieldErrors.password}>
                  <div className="relative flex items-center">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (fieldErrors.password) {
                          setFieldErrors((prev) => ({ ...prev, password: null }));
                        }
                      }}
                      required
                      placeholder="Enter your password"
                      className="pr-12"
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

                <div className="pt-2">
                  <Button
                    type="submit"
                    pending={pending}
                    pendingLabel="Signing you in"
                    disabled={success}
                    fullWidth
                    size="lg"
                    className="rounded-pill shadow-e1 transition-transform active:scale-[0.99]"
                  >
                    {success ? (
                      <span className="inline-flex items-center gap-2">
                        <Icon name="check" size={18} />
                        <span>Admitted</span>
                      </span>
                    ) : (
                      'Sign in'
                    )}
                  </Button>
                </div>
              </form>

              {/* Sample Society Credentials Autofill Strip */}
              <div className="mt-6 pt-5 border-t border-border">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="type-micro text-content-subtle uppercase tracking-wider font-semibold">
                    Sample society accounts
                  </span>
                  <span className="type-micro text-content-muted font-medium">
                    Click to fill form
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {DEMO_ROLES.map((item) => {
                    const isCurrent = email === item.email;
                    return (
                      <button
                        key={item.email}
                        type="button"
                        disabled={pending || success}
                        onClick={() => handleAutofill(item.email)}
                        className={`group flex flex-col justify-between rounded-xl border p-3 text-left shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer ${
                          isCurrent
                            ? 'border-accent bg-accent-soft/40 ring-1 ring-accent'
                            : 'border-border bg-surface hover:border-border-strong hover:bg-surface-sunken'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 w-full mb-1.5">
                          <span className="text-base leading-none" aria-hidden>{item.emoji}</span>
                          <span className="type-micro font-medium text-accent">
                            {isCurrent ? 'Selected' : 'Fill in'}
                          </span>
                        </div>
                        <div>
                          <p className="type-body text-sm font-semibold text-content leading-snug">
                            {item.role}
                          </p>
                          <p className="type-micro text-content-muted font-medium mt-0.5">
                            {item.detail}
                          </p>
                          <p className="type-micro text-content-subtle truncate mt-0.5 text-[11px]" title={item.email}>
                            {item.email}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Below the form: Quiet navigation links */}
            <div className="mt-8 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
              <Link
                href="/register"
                className="type-label text-content-muted hover:text-accent transition-colors"
              >
                New here? <span className="font-semibold text-accent underline underline-offset-2">Register</span>
              </Link>
              <Link
                href="/reset-password"
                className="type-label text-content-subtle hover:text-content transition-colors underline underline-offset-2"
              >
                Forgot password?
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Footer Note */}
      <footer className="py-4 text-center">
        <p className="type-micro text-content-subtle">
          GrihaOne · Residential Society Operating System
        </p>
      </footer>
    </div>
  );
}
