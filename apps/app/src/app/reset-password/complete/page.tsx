'use client';

import { Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Field, Input, Logo, Skeleton } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { simple } from '@/lib/api';
import { screenClass } from '@/lib/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Password reset, step two — reached from the link in the email. The token arrives in the query
 * string; if it is missing or malformed the screen says so plainly instead of pretending to work,
 * and an expired or already-used token comes back from the server with its own explanation. On
 * success the new password is in force everywhere, so the only next step is sign-in.
 */
export default function ResetPasswordCompletePage(): ReactNode {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 px-6 py-10">
          <Skeleton variant="text" width={200} height={28} />
          <Skeleton variant="text" width="full" />
          <Skeleton variant="text" width="full" />
        </main>
      }
    >
      <ResetPasswordComplete />
    </Suspense>
  );
}

function ResetPasswordComplete(): ReactNode {
  const reduced = useReducedMotion();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ password?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setFieldError({});
    const problems: { password?: string; confirm?: string } = {};
    if (password.length < 10 || !(/[a-z]/.test(password) && /[A-Z]/.test(password)) || !(/\d/.test(password) || /[^A-Za-z0-9]/.test(password))) {
      problems.password = 'At least 10 characters, with upper and lower case, and a number or a symbol';
    }
    if (confirm !== password) problems.confirm = 'The two passwords do not match';
    if (Object.keys(problems).length > 0) {
      setFieldError(problems);
      return;
    }
    setPending(true);
    const result = await simple<null>('/api/auth/password/reset-complete', {
      method: 'POST',
      json: { token, password },
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      return;
    }
    setError(result.error.message);
  }

  if (token === '') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-6 py-10">
        <div className={screenClass('forward', reduced)}>
          <span className="flex size-14 items-center justify-center rounded-full border border-critical-border bg-critical-soft text-critical">
            <Icon name="key" size={26} />
          </span>
          <h1 className="type-title mt-4">This link is incomplete</h1>
          <p className="type-body text-content-muted">
            The reset link you followed did not carry its token. Open the email again and tap the
            button inside it, or request a fresh link.
          </p>
          <Link href="/reset-password" className="text-accent focus-ring rounded-sm type-body">
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-6 py-10">
        <div className={screenClass('forward', reduced)}>
          <span className="flex size-14 items-center justify-center rounded-full border border-positive-border bg-positive-soft text-positive">
            <Icon name="check" size={28} />
          </span>
          <h1 className="type-title mt-4">Password changed</h1>
          <p className="type-body text-content-muted">
            Your new password is in force everywhere — this phone and any other device where you
            were signed in. Sign in to continue.
          </p>
          <Link href="/sign-in" className="text-accent focus-ring rounded-sm type-body">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 pb-10 pt-8">
      <div className="flex items-center justify-between">
        <Link href="/sign-in" aria-label="Back to sign in" className="tab-target -ml-2 flex items-center justify-center rounded-lg text-content-muted focus-ring-inset">
          <Icon name="chevron-left" />
        </Link>
        <Logo variant="wordmark" size={26} />
      </div>

      <div className="mt-8 flex flex-col gap-4">
        <h1 className="type-title">Set a new password</h1>
        <p className="type-body text-content-muted">
          Choose something you have not used here before. It takes effect the moment you save it.
        </p>
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {error !== null ? (
            <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
              {error}
            </p>
          ) : null}
          <Field
            label="New password"
            required
            error={fieldError.password}
            hint="At least 10 characters, with upper and lower case, and a number or a symbol."
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              leading={<Icon name="key" size={16} />}
            />
          </Field>
          <Field label="Confirm new password" required error={fieldError.confirm}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
          </Field>
          <Button type="submit" size="lg" fullWidth pending={pending} pendingLabel="Saving">
            Save new password
          </Button>
        </form>
      </div>
    </main>
  );
}
