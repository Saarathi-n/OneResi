'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, Input, Money, Sheet, Skeleton, StatusPill, useToast } from '@oneresi/ui';
import * as C from '@oneresi/contracts';
import { Icon } from '@/components/icons';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { roleHome, usePerson, useSession } from '@/lib/session';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';

/**
 * Who you are as the society knows you, the one thing you own here (your password), and the door.
 * Every role lands on this page — resident, committee, gate — because signing out and changing a
 * password are nobody's monopoly. Changing the password signs you out everywhere, said before, not
 * after.
 */
export default function ProfilePage(): ReactNode {
  const router = useRouter();
  const person = usePerson();
  const { status, signOut } = useSession();
  const reduced = useReducedMotion();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Any signed-in role may sit here; a signed-out person is walked to the door.
  useEffect(() => {
    if (status.state === 'signed-out') router.replace('/sign-in');
  }, [status.state, router]);

  if (status.state === 'loading') {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3 px-4 pt-6" aria-busy>
        <span className="sr-only">Checking your session</span>
        <Skeleton height={120} className="rounded-xl" />
        <Skeleton height={56} className="rounded-xl" />
        <Skeleton height={56} className="rounded-xl" />
      </div>
    );
  }

  async function handleSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    await signOut();
    router.replace('/sign-in');
  }

  return (
    <Shell
      title="Your profile"
      backHref={person === null ? undefined : roleHome(person.role)}
    >
      <div className="flex flex-col gap-4">
        {person === null ? (
          <Card padding="default" pending>
            <span className="sr-only">Loading your details</span>
          </Card>
        ) : (
          <div className="row-in" style={rowStyle(0, reduced)}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="type-body font-medium">{person.name}</p>
                  <p className="type-label text-content-subtle">
                    {person.home !== null
                      ? `${person.home.blockName}, ${person.home.label}`
                      : 'No home attached'}
                  </p>
                </div>
                <StatusPill descriptor={C.USER_STATUS[person.status]} size="sm" />
              </div>

              <dl className="mt-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Icon name="user" size={16} className="shrink-0 text-content-muted" />
                  <div>
                    <dt className="type-micro uppercase tracking-wide text-content-subtle">Role</dt>
                    <dd className="type-label">{C.ROLE[person.role].label}</dd>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Icon name="mail" size={16} className="shrink-0 text-content-muted" />
                  <div className="min-w-0">
                    <dt className="type-micro uppercase tracking-wide text-content-subtle">Email</dt>
                    <dd className="truncate type-label">{person.email}</dd>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Icon name="phone" size={16} className="shrink-0 text-content-muted" />
                  <div>
                    <dt className="type-micro uppercase tracking-wide text-content-subtle">Phone</dt>
                    <dd className="type-label">{person.phone}</dd>
                  </div>
                </div>
                {person.home !== null ? (
                  <div className="flex items-center gap-3">
                    <Icon name="wallet" size={16} className="shrink-0 text-content-muted" />
                    <div>
                      <dt className="type-micro uppercase tracking-wide text-content-subtle">
                        Monthly maintenance
                      </dt>
                      <dd>
                        <Money value={person.home.monthlyChargePaise} compact />
                      </dd>
                    </div>
                  </div>
                ) : null}
              </dl>
            </Card>
          </div>
        )}

        <div className="row-in" style={rowStyle(1, reduced)}>
          <Card padding="tight">
            <button
              type="button"
              onClick={() => {
                setChanging(true);
              }}
              className="tab-target flex w-full items-center justify-between gap-3 rounded-xl text-left focus-ring-inset"
            >
              <span className="flex items-center gap-3">
                <Icon name="key" size={18} className="text-content-muted" />
                <span className="type-body">Change password</span>
              </span>
              <Icon name="chevron-right" size={18} className="text-content-muted" />
            </button>
          </Card>
        </div>

        <div className="row-in" style={rowStyle(2, reduced)}>
          <Card padding="tight">
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                void handleSignOut();
              }}
              className="tab-target flex w-full items-center justify-between gap-3 rounded-xl text-left focus-ring-inset disabled:opacity-50"
            >
              <span className="flex items-center gap-3">
                <Icon name="logout" size={18} className="text-content-muted" />
                <span className="type-body">{signingOut ? 'Signing you out…' : 'Sign out'}</span>
              </span>
            </button>
          </Card>
        </div>
      </div>

      {changing ? (
        <ChangePasswordSheet
          onClose={() => {
            setChanging(false);
          }}
          onChanged={() => {
            setChanging(false);
            toast.show({
              title: 'Password changed',
              description: 'Sign in again with the new one.',
            });
          }}
        />
      ) : null}
    </Shell>
  );
}

function ChangePasswordSheet({
  onClose,
  onChanged,
}: {
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): ReactNode {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ currentPassword?: string; newPassword?: string }>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const problems: { currentPassword?: string; newPassword?: string } = {};
    if (currentPassword === '') problems.currentPassword = 'Enter your current password';
    if (newPassword.length < 10) problems.newPassword = 'Use at least 10 characters';
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setErrors({});
    setPending(true);
    setFailed(null);

    const result = await simple<null>('/api/auth/change-password', {
      method: 'POST',
      json: { currentPassword, newPassword },
    });
    setPending(false);
    if (result.ok) {
      onChanged();
      return;
    }
    if (result.error.field === 'currentPassword') setErrors({ currentPassword: result.error.message });
    else if (result.error.field === 'newPassword') setErrors({ newPassword: result.error.message });
    else setFailed(result.error.message);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change password"
      description="This signs you out everywhere — on this phone and any other device."
      pending={pending}
      footer={
        <Button size="lg" fullWidth pending={pending} pendingLabel="Changing" onClick={() => { void submit(); }}>
          Change password
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Current password" required error={errors.currentPassword}>
          <Input
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
          />
        </Field>

        <Field
          label="New password"
          required
          error={errors.newPassword}
          hint="At least 10 characters, with upper and lower case, and a number or a symbol."
        >
          <Input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
          />
        </Field>

        {failed !== null ? (
          <p role="alert" className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical">
            {failed}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
