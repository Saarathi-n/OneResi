'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Logo,
  buttonClass,
} from '@oneresi/ui';
import { call } from '@/lib/session';

/**
 * Completing a password reset from an emailed link. The token arrives in the link; the person
 * only ever sees the two password fields.
 */
function ResetCompleteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await call<null>('/api/auth/password/reset-complete', {
      method: 'POST',
      json: { token, password },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push('/sign-in?reset=done');
  }

  return (
    <Card className="w-full max-w-md" elevation={1}>
      <CardBody>
        <h1 className="type-title text-content">Choose a new password</h1>
        <p className="type-body mt-2 text-content-muted">
          Your reset link is single-use. After this, every session on your account signs out.
        </p>
        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          noValidate
        >
          <Field
            label="New password"
            required
            hint="At least 10 characters, with upper and lower case, and a number or symbol."
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Confirm password" required>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </Field>
          {error !== null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            pending={pending}
            pendingLabel="Setting your password"
            fullWidth
            size="lg"
          >
            Set new password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export default function ResetCompletePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="OneResi home">
            <Logo variant="wordmark" size={28} />
          </Link>
          <Link href="/sign-in" className={buttonClass('ghost', 'sm')}>
            Back to sign in
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <Suspense fallback={null}>
          <ResetCompleteForm />
        </Suspense>
      </main>
    </div>
  );
}
