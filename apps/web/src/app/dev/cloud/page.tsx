'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton } from '@grihaone/ui';
import { call, useGuardedSession } from '@/lib/session';

/**
 * The deployment console: what Terraform holds (state, outputs), what AWS is running (the
 * service, the database, the month's spend against the budget), and the operations over them —
 * plan, apply, stop, start, destroy. Development only, committee only.
 *
 * The two writes that change the world carry their own confirmations: apply runs only what the
 * last plan in this server said, and only after the word is typed; destroy runs only after the
 * stack's own name is typed, and the stack's guards (deletion protection, non-empty buckets)
 * refuse unless tfvars explicitly allowed a destructive teardown. Stop and start are the cheap,
 * reversible ones — the cost controls.
 */

interface JobStep {
  label: string;
  status: 'running' | 'ok' | 'fail';
  exit: number | null;
  output: string;
}

interface JobView {
  id: number;
  action: 'deploy' | 'destroy';
  startedAt: string;
  steps: JobStep[];
  done: boolean;
  ok: boolean | null;
}

interface CloudStatus {
  terraform: { path: string; version: string } | null;
  stackDir: boolean;
  tfvars: boolean;
  stateReachable: boolean;
  stateError: string | null;
  resourceCount: number | null;
  outputs: Record<string, unknown>;
  services: { ecs: string; rds: string; budget: string };
  stackName: string;
  lastPlan: { changes: boolean; at: string } | null;
  job: JobView | null;
  note?: string;
}

interface RunOutcome {
  ran: 'deploy' | 'plan' | 'apply' | 'stop' | 'start' | 'destroy';
  ok: boolean;
  changes?: boolean;
  output: string;
}

export default function CloudConsolePage() {
  // The page is committee-only like its API; without the guard an expired session left the
  // skeleton spinning forever — the API answered 401 and nothing ever replaced the skeleton.
  const guarded = useGuardedSession('COMMITTEE');
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [plan, setPlan] = useState<RunOutcome | undefined>();
  const [applyRun, setApplyRun] = useState<RunOutcome | undefined>();
  const [scaleRun, setScaleRun] = useState<RunOutcome | undefined>();
  const [pending, setPending] = useState<string | null>(null);

  const [deployWord, setDeployWord] = useState('');
  const [applyWord, setApplyWord] = useState('');
  const [destroyWord, setDestroyWord] = useState('');

  const refresh = useCallback(async () => {
    const result = await call<CloudStatus>('/api/dev/cloud');
    if (result.ok) setStatus(result.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a job (deploy/destroy) runs, poll for its live steps — every three seconds is where
  // the step output visibly advances without hammering a dev server.
  const job = status?.job ?? null;
  const jobRunning = job !== null && !job.done;
  useEffect(() => {
    if (!jobRunning) return;
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [jobRunning, refresh]);

  async function run(
    target: 'deploy' | 'plan' | 'apply' | 'stop' | 'start' | 'destroy',
    confirm?: string,
  ): Promise<void> {
    setPending(target);
    const result = await call<RunOutcome>('/api/dev/cloud', {
      method: 'POST',
      json: { action: target, ...(confirm === undefined ? {} : { confirm }) },
    });
    setPending(null);
    const outcome: RunOutcome = result.ok
      ? result.data
      : { ran: target, ok: false, output: result.error.message };
    if (target === 'deploy') {
      if (result.ok) setDeployWord('');
    }
    if (target === 'plan') setPlan(outcome);
    if (target === 'apply') {
      setApplyRun(outcome);
      if (result.ok) setApplyWord('');
    }
    if (target === 'stop' || target === 'start') setScaleRun(outcome);
    if (target === 'destroy') {
      if (result.ok) setDestroyWord('');
    }
    void refresh();
  }

  if (guarded.state !== 'signed-in' || status === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton variant="text" width={220} height={32} />
        <Skeleton variant="block" height={140} />
        <Skeleton variant="block" height={140} />
      </div>
    );
  }

  const deployed = status.resourceCount !== null && status.resourceCount > 0;
  const planSaysChanges = plan?.ok === true && plan.changes === true;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-display text-content">Cloud console</h1>
          <p className="type-body mt-1 text-content-muted">
            The {status.stackName} stack: what is deployed, what it costs, and the operations over
            it. Development only.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} pending={pending === 'refresh'}>
          Refresh
        </Button>
      </div>

      {job !== null ? <JobProgress job={job} /> : null}

      <Card elevation={1}>
        <CardHeader title="Terraform" subtitle="The binary this server runs, and what its state holds." />
        <CardBody className="space-y-2">
          {status.terraform === null ? (
            <p className="type-body text-critical">{status.note ?? 'No terraform binary found.'}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="type-label text-content">{status.terraform.version}</span>
                <Badge tone={status.tfvars ? 'positive' : 'caution'} size="sm">
                  {status.tfvars ? 'tfvars present' : 'tfvars missing'}
                </Badge>
              </div>
              <p className="type-micro break-all text-content-subtle">{status.terraform.path}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="type-label text-content">
                  {status.stateReachable
                    ? `${status.resourceCount ?? 0} resources in state`
                    : 'state not reachable'}
                </span>
                {status.stateReachable ? (
                  <Badge tone={deployed ? 'positive' : 'neutral'} size="sm">
                    {deployed ? 'stack deployed' : 'state empty'}
                  </Badge>
                ) : null}
              </div>
              {status.stateError !== null ? (
                <pre className="type-micro mt-1 max-h-32 overflow-auto rounded-lg bg-surface-sunken p-3 text-content-muted">
                  {status.stateError.trim()}
                </pre>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader title="What is running" subtitle="Live from AWS: the service, the database, the month's spend." />
        <CardBody className="space-y-2">
          <Line label="App service" value={status.services.ecs} />
          <Line label="Database" value={status.services.rds} />
          <Line label="Budget" value={status.services.budget} />
          {Object.keys(status.outputs).length > 0 ? (
            <div className="pt-1">
              <p className="type-label text-content">Outputs</p>
              <pre className="type-micro mt-1 max-h-40 overflow-auto rounded-lg bg-surface-sunken p-3 text-content-muted">
                {Object.entries(status.outputs)
                  .map(([key, value]) => `${key} = ${typeof value === 'string' ? value : JSON.stringify(value)}`)
                  .join('\n')}
              </pre>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader
          title="Deploy"
          subtitle="The whole first-deploy sequence as one button: bundles, the state bucket if a teardown removed it, the image repository, both images built and pushed, then the full apply."
        />
        <CardBody className="space-y-3">
          <p className="type-body text-content-muted">
            Needs Docker Desktop running and AWS credentials in this server&apos;s environment. Safe
            against an already-deployed stack: every step is idempotent and the final apply finds
            nothing to change. Budget guard: the stack&apos;s alarms watch the account either way.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="type-input h-11 w-40 rounded-lg border border-border-strong bg-surface-raised px-3.5"
              placeholder="type: deploy"
              value={deployWord}
              onChange={(event) => setDeployWord(event.target.value)}
              aria-label="Type the word deploy to confirm"
            />
            <Button
              disabled={deployWord !== 'deploy' || jobRunning}
              pending={pending === 'deploy' || jobRunning}
              pendingLabel="Deploying — watch the progress above"
              onClick={() => void run('deploy', 'deploy')}
            >
              Deploy the stack
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader
          title="Plan and apply"
          subtitle="Plan reads the account and writes nothing; apply runs what the last plan said."
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              pending={pending === 'plan'}
              pendingLabel="Planning"
              onClick={() => void run('plan')}
            >
              Plan the stack
            </Button>
            {plan !== undefined ? (
              <Badge tone={plan.ok ? (plan.changes ? 'caution' : 'positive') : 'critical'} size="sm">
                {plan.ok ? (plan.changes ? 'changes planned' : 'nothing to change') : 'plan failed'}
              </Badge>
            ) : null}
          </div>
          {plan !== undefined ? <Output outcome={plan} /> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input
              className="type-input h-11 w-40 rounded-lg border border-border-strong bg-surface-raised px-3.5"
              placeholder="type: apply"
              value={applyWord}
              onChange={(event) => setApplyWord(event.target.value)}
              aria-label="Type the word apply to confirm"
            />
            <Button
              disabled={!planSaysChanges || applyWord !== 'apply'}
              pending={pending === 'apply'}
              pendingLabel="Applying"
              onClick={() => void run('apply', 'apply')}
            >
              Apply
            </Button>
            {!planSaysChanges ? (
              <span className="type-micro text-content-subtle">
                Unlocks after a plan that found changes.
              </span>
            ) : null}
          </div>
          {applyRun !== undefined ? <Output outcome={applyRun} /> : null}
        </CardBody>
      </Card>

      <Card elevation={1}>
        <CardHeader
          title="Stop and start"
          subtitle="desired_count 0 and 1 — the Fargate meter. Nothing else changes."
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" pending={pending === 'stop'} pendingLabel="Stopping" onClick={() => void run('stop')}>
              Stop the service
            </Button>
            <Button pending={pending === 'start'} pendingLabel="Starting" onClick={() => void run('start')}>
              Start the service
            </Button>
          </div>
          {scaleRun !== undefined ? <Output outcome={scaleRun} /> : null}
        </CardBody>
      </Card>

      <Card elevation={1} className="border-critical">
        <CardHeader
          title="Destroy"
          subtitle="Syncs the cloud registry to local first, then takes the whole stack down. Refuses if the sync fails."
        />
        <CardBody className="space-y-3">
          <p className="type-body text-critical">
            Before anything is deleted, the property registry (blocks, units, facilities) is pulled
            into the local database — a destroy that loses the cloud&apos;s registry because nobody
            synced first is the mistake this refuses to make. Accounts, receipts and mail have no
            second home by design. The stack&apos;s own guards also refuse while deletion protection
            is on; allowing it is a tfvars change you make on purpose.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="type-input h-11 w-48 rounded-lg border border-critical bg-surface-raised px-3.5"
              placeholder={`type: ${status.stackName}`}
              value={destroyWord}
              onChange={(event) => setDestroyWord(event.target.value)}
              aria-label="Type the stack name to confirm destruction"
            />
            <Button
              variant="danger"
              disabled={destroyWord !== status.stackName || jobRunning}
              pending={pending === 'destroy' || (jobRunning && job.action === 'destroy')}
              pendingLabel="Destroying — watch the progress above"
              onClick={() => void run('destroy', status.stackName)}
            >
              Destroy the stack
            </Button>
          </div>
        </CardBody>
      </Card>

      <p className="type-micro text-content-subtle">
        The same operations as the command line: <code>pnpm cloud:up</code>,{' '}
        <code>pnpm cloud:stop</code>, <code>pnpm cloud:down</code>.{' '}
        <Link href="/dev/sync" className="text-accent underline-offset-2 hover:underline">
          The database sync screen is here.
        </Link>
      </p>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="type-label text-content">{label}</span>
      <span className="type-body text-content-muted">{value}</span>
    </div>
  );
}

function Output({ outcome }: { outcome: RunOutcome }) {
  return (
    <div>
      <div className="mt-1 flex items-center gap-2">
        <Badge tone={outcome.ok ? 'positive' : 'critical'} size="sm">
          {outcome.ok ? 'done' : 'failed'}
        </Badge>
      </div>
      <pre className="type-micro mt-2 max-h-80 overflow-auto rounded-lg bg-surface-sunken p-3 text-content-muted">
        {outcome.output.trim()}
      </pre>
    </div>
  );
}

/**
 * The live progress of a deploy or destroy: every step with its verdict, the running one with
 * its tail streaming underneath, and the job's verdict when it lands. This is what tells the
 * person pressing the button where the twenty minutes went.
 */
function JobProgress({ job }: { job: JobView }) {
  const running = job.steps.find((step) => step.status === 'running');
  return (
    <Card elevation={1} className={job.done ? (job.ok ? '' : 'border-critical') : ''}>
      <CardHeader
        title={job.done ? `${job.action} ${job.ok ? 'complete' : 'failed'}` : `${job.action} in progress`}
        subtitle={`Started ${new Date(job.startedAt).toLocaleTimeString()}. ${job.done
          ? job.ok
            ? 'Every step finished cleanly.'
            : 'A step failed — its output is below; later steps did not run.'
          : 'This page refreshes itself every few seconds. Deploy is 15-30 minutes; destroy about 20, and the tail is the slow part by design.'}`}
      />
      <CardBody className="space-y-2">
        <ol className="space-y-1">
          {job.steps.map((step) => (
            <li key={`${step.label}-${job.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <span className="type-label text-content">{step.label}</span>
              <Badge
                tone={step.status === 'ok' ? 'positive' : step.status === 'fail' ? 'critical' : 'caution'}
                size="sm"
              >
                {step.status === 'ok' ? 'ok' : step.status === 'fail' ? `failed (exit ${step.exit})` : 'running…'}
              </Badge>
            </li>
          ))}
        </ol>
        {running !== undefined ? (
          <div>
            <p className="type-label text-content">Now: {running.label}</p>
            <pre className="type-micro mt-1 max-h-48 overflow-auto rounded-lg bg-surface-sunken p-3 text-content-muted">
              {running.output.trim() || 'starting…'}
            </pre>
          </div>
        ) : null}
        {job.done ? (
          <details>
            <summary className="type-label cursor-pointer text-content-muted">Full step output</summary>
            {job.steps.map((step) => (
              <div key={`out-${step.label}-${job.id}`} className="mt-2">
                <p className="type-label text-content">{step.label}</p>
                <pre className="type-micro mt-1 max-h-48 overflow-auto rounded-lg bg-surface-sunken p-3 text-content-muted">
                  {step.output.trim()}
                </pre>
              </div>
            ))}
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
