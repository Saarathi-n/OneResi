'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, Logo, Card, CardBody } from '@oneresi/ui';
import { signIn } from '@/lib/session';

/** The sign-in screen. One form, the reset link, and the path to registration. */
export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setPending(true);
    setError(null);
    const result = await signIn(email, password);
    if (result.ok) {
      router.push('/home');
      return;
    }
    setPending(false);
    setError(result.error.message);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="OneResi home">
            <Logo variant="wordmark" size={28} />
          </Link>
          <Link href="/register">
            <Button variant="ghost" size="sm">
              Create an account
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <Card className="w-full max-w-md" elevation={1}>
          <CardBody>
            <h1 className="type-title text-content">Sign in to your society</h1>
            <p className="type-body mt-2 text-content-muted">
              Use the email address you registered with.
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

              <Field label="Password" required>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>

              {error !== null ? (
                <p className="type-body text-critical" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" pending={pending} fullWidth size="lg">
                Sign in
              </Button>
            </form>

            <p className="type-body mt-6 text-content-subtle">
              Forgot your password?{' '}
              <Link href="/reset-password" className="text-accent underline underline-offset-2">
                Request a reset link
              </Link>
            </p>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
