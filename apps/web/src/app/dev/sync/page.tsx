'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton } from '@grihaone/ui';
import { call, useGuardedSession } from '@/lib/session';

/**
 * The local↔cloud bridge, as one screen: compare the two databases, bring the property registry
 * down from the cloud, or push the local one up. Every write is two presses — the plan first,
 * the write only after the plan has been read — which is the same confirmation the command-line
 * tools ask for at a terminal.
 *
 * What moves is the property registry: blocks, units and their charges, and the facilities.
 * Accounts, sessions, receipts and mail are each database's own state and are never synced.
 */

interface Status {
  cloud: string | null;
  localFile: boolean;
}

interface RunResult {
  ran: 'diff' | 'pull' | 'push';
  applied: boolean;
  ok: boolean;
  output: string;
}

export default function SyncPage() {
  // Committee-only like its API; the guard sends an expired session to sign-in instead of
  // leaving the skeleton spinning on a 401 nobody renders.
  const guarded = useGuardedSession('COMMITTEE');
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Record<'diff' | 'pull' | 'push', RunResult | undefined>>({ diff: undefined, pull: undefined, push: undefined });
  const [pending, setPending] = useState<'diff' | 'pull' | 'push' | null>(null);

  const refresh = useCallback(async () => {
    const result = await call<Status>('/api/dev/sync');
    if (result.ok) setStatus(result.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: 'diff' | 'pull' | 'push', apply: boolean): Promise<void> {
    setPending(action);
    const result = await call<RunResult>('/api/dev/sync', {
      method: 'POST',
      json: { action, apply },
    });
    setPending(null);
    setRuns((current) => ({
      ...current,
      [action]: result.ok ? result.data : { ran: action, applied: apply, ok: false, output: result.error.message },
    }));
    if (result.ok && apply) void refresh();
  }

  if (guarded.state !== 'signed-in' || status === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton variant="text" width={200} height={32} />
        <Skeleton variant="block" height={120} />
      </div>
    );
  }

  const cloudReady = status.cloud !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="type-display text-content">Local ↔ cloud sync</h1>
        <p className="type-body mt-1 text-content-muted">
          Move the society&apos;s property registry between this machine and the cloud database.
          Accounts, receipts and mail are each side&apos;s own state and never move.
        </p>
      </div>

      <Card elevation={1}>
        <CardHeader title="The two sides" />
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="type-label text-content">Cloud database</span>
            {cloudReady ? (
              <Badge tone="positive" size="sm">configured</Badge>
            ) : (
              <Badge tone="caution" size="sm">not configured</Badge>
            )}
          </div>
          <p className="type-body break-all text-content-muted">
            {cloudReady ? status.cloud : 'Run pnpm cloud:env, paste its export line into the shell that starts the dev server, and restart.'}
          </p>
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="type-label text-content">Local database</span>
            <Badge tone={status.localFile ? 'positive' : 'caution'} size="sm">
              {status.localFile ? 'present' : 'missing'}
            </Badge>
          </div>
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader
          title="Compare"
          subtitle="Row counts on every table, both sides, plus a registry diff. Writes nothing."
        />
        <CardBody>
          <Button
            disabled={!cloudReady}
            pending={pending === 'diff'}
            pendingLabel="Comparing"
            onClick={() => void run('diff', false)}
          >
            Compare local and cloud
          </Button>
          <Output run={runs.diff} />
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader
          title="Pull — cloud → local"
          subtitle="Brings the cloud registry down into this machine's file."
        />
        <CardBody className="space-y-3">
          <SyncActions
            action="pull"
            disabled={!cloudReady}
            pending={pending}
            planned={runs.pull?.applied === false && runs.pull.ok}
            onPlan={() => void run('pull', false)}
            onApply={() => void run('pull', true)}
          />
          <Output run={runs.pull} />
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader
          title="Push — local → cloud"
          subtitle="Sends this machine's registry up to the cloud database."
        />
        <CardBody className="space-y-3">
          <SyncActions
            action="push"
            disabled={!cloudReady}
            pending={pending}
            planned={runs.push?.applied === false && runs.push.ok}
            onPlan={() => void run('push', false)}
            onApply={() => void run('push', true)}
          />
          <Output run={runs.push} />
        </CardBody>
      </Card>

      <p className="type-micro text-content-subtle">
        The same operations as the command line: <code>pnpm db:diff</code>, <code>pnpm db:pull</code>,{' '}
        <code>pnpm db:push</code>. This page exists only in development.
      </p>
    </div>
  );
}

function SyncActions({
  action,
  disabled,
  pending,
  planned,
  onPlan,
  onApply,
}: {
  action: 'pull' | 'push';
  disabled: boolean;
  pending: 'diff' | 'pull' | 'push' | null;
  planned: boolean;
  onPlan: () => void;
  onApply: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        disabled={disabled}
        pending={pending === action}
        pendingLabel="Planning"
        onClick={onPlan}
      >
        Plan it first
      </Button>
      <Button
        variant={action === 'push' ? 'danger' : 'primary'}
        disabled={disabled || !planned}
        pending={pending === action}
        pendingLabel="Writing"
        onClick={onApply}
      >
        {action === 'pull' ? 'Write to local' : 'Write to cloud'}
      </Button>
      {!planned ? (
        <span className="type-micro text-content-subtle">
          The write unlocks after the plan has been read.
        </span>
      ) : null}
    </div>
  );
}

function Output({ run }: { run: RunResult | undefined }) {
  if (run === undefined) return null;
  return (
    <div>
      <div className="mt-3 flex items-center gap-2">
        <Badge tone={run.ok ? 'positive' : 'critical'} size="sm">
          {run.applied ? (run.ok ? 'written' : 'write failed') : run.ok ? 'plan' : 'failed'}
        </Badge>
      </div>
      <pre className="type-micro mt-2 max-h-80 overflow-auto rounded-lg bg-surface-sunken p-3 text-content-muted">
        {run.output.trim()}
      </pre>
    </div>
  );
}
