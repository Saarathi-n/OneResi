'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Field, Input, Logo } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { simple } from '@/lib/api';
import { screenClass } from '@/lib/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Password reset, step one. The response is the same whether the email is known or not — the
 * screen never confirms an account exists — so the copy says a link is on its way and leaves it
 * there. The link opens the web app's reset-complete screen (and the mobile complete screen for
 * links opened on a phone).
 */
export default function ResetPasswordPage() {
  const reduced = useReducedMotion();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter the email you registered with');
      return;
    }
    setPending(true);
    const result = await simple<null>('/api/auth/password/reset-request', {
      method: 'POST',
      json: { email: email.trim() },
    });
    setPending(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setError(result.error.message);
  }

  if (sent) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-6 py-10">
        <div className={screenClass('forward', reduced)}>
          <span className="flex size-14 items-center justify-center rounded-full border border-info-border bg-info-soft text-info">
            <Icon name="mail" size={26} />
          </span>
          <h1 className="type-title mt-4">Check your email</h1>
          <p className="type-body text-content-muted">
            If {email.trim()} belongs to an account here, a reset link is on its way. The link
            expires in an hour. Nothing changes until you set a new password with it.
          </p>
          <Link href="/sign-in" className="text-accent focus-ring rounded-sm type-body">
            Back to sign in
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
        <h1 className="type-title">Reset your password</h1>
        <p className="type-body text-content-muted">
          Enter the email you registered with and we will send a reset link. It expires in an hour,
          and your current password keeps working until you use it.
        </p>
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {error !== null ? (
            <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
              {error}
            </p>
          ) : null}
          <Field label="Email" required hint="The address you registered with">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              leading={<Icon name="user" size={16} />}
            />
          </Field>
          <Button type="submit" size="lg" fullWidth pending={pending} pendingLabel="Sending">
            Send reset link
          </Button>
        </form>
      </div>
    </main>
  );
}
