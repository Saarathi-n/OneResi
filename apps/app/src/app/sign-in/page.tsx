'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Logo } from '@oneresi/ui';
import { Icon } from '@/components/icons';
import { roleHome, useSession } from '@/lib/session';

/**
 * Sign-in. The shortest surface in the product: email and password, a link to registration, a
 * link to password reset. Where you land afterwards is the role's decision, not a menu — a
 * resident never sees the committee desk and a guard never sees either.
 */
export default function SignInPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setFieldError({});
    if (email.trim().length === 0) {
      setFieldError({ email: 'Enter the email you registered with' });
      return;
    }
    if (password.length === 0) {
      setFieldError({ password: 'Enter your password' });
      return;
    }
    setPending(true);
    const result = await signIn(email, password);
    if (!result.ok) {
      setPending(false);
      setError(result.error ?? 'That did not work. Check your details and try again.');
      return;
    }
    router.replace(roleHome(result.person.role));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 pb-10">
      <div className="flex flex-1 flex-col justify-center gap-8 py-10">
        <div className="flex flex-col items-start gap-3">
          <Logo variant="wordmark" size={40} />
          <p className="type-body text-content-muted">
            Dues, visitor passes, complaints and gate approvals for your community.
          </p>
        </div>

        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {error !== null ? (
            <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
              {error}
            </p>
          ) : null}

          <Field
            label="Email"
            required
            error={fieldError.email}
            hint="The address you registered with"
          >
            <Input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              leading={<Icon name="user" size={16} />}
            />
          </Field>

          <Field label="Password" required error={fieldError.password}>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </Field>

          <Button type="submit" size="lg" fullWidth pending={pending} pendingLabel="Signing in">
            Sign in
          </Button>
        </form>

        <div className="flex flex-col gap-3 type-body">
          <Link href="/reset-password" className="text-accent focus-ring rounded-sm">
            Forgot your password?
          </Link>
          <p className="text-content-muted">
            New to the society?{' '}
            <Link href="/register" className="text-accent focus-ring rounded-sm">
              Create your account
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
