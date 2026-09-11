'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
 * Requesting a reset link. The endpoint answers the same way whether or not the address has an
 * account (D-22's rule, kept), so the screen says exactly that instead of guessing.
 */

/** The same key sign-in remembers — a reset almost always follows a failed sign-in. */
const EMAIL_KEY = 'oneresi.sign-in.email';

export default function ResetRequestPage() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    try {
      const last = window.localStorage.getItem(EMAIL_KEY);
      if (last !== null && last !== '') setEmail(last);
    } catch {
      // A blocked localStorage just means typing the address.
    }
  }, []);

  async function handleSubmit(): Promise<void> {
    setPending(true);
    await call<null>('/api/auth/password/reset-request', {
      method: 'POST',
      json: { email },
    });
    setPending(false);
    setSent(true);
  }

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
        <Card className="w-full max-w-md" elevation={1}>
          <CardBody>
            {sent ? (
              <>
                <h1 className="type-title text-content">Check your email</h1>
                <p className="type-body mt-2 text-content-muted">
                  If an account exists for {email}, a reset link is on its way. The link works for
                  15 minutes and can be used once.
                </p>
                <Link href="/sign-in" className={buttonClass('secondary', 'md', 'mt-6')}>
                  Back to sign in
                </Link>
              </>
            ) : (
              <>
                <h1 className="type-title text-content">Reset your password</h1>
                <p className="type-body mt-2 text-content-muted">
                  Enter your email address and we will send you a link to choose a new password.
                </p>
                <form
                  className="mt-6 space-y-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmit();
                  }}
                  noValidate
                >
                  <Field label="Email" required>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </Field>
                  <Button
                    type="submit"
                    pending={pending}
                    pendingLabel="Sending the link"
                    fullWidth
                    size="lg"
                  >
                    Send reset link
                  </Button>
                </form>
              </>
            )}
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
