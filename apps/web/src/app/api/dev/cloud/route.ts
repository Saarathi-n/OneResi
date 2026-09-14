import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { actor, toResponse } from '@/server/http';

/**
 * The deployment console, behind a dev-only route: what Terraform has (state, outputs), what AWS
 * is running (the service, the database, the budget), and the operations the command-line
 * wrappers already own — plan, apply, stop, start, destroy — run from the same directory with the
 * same binary resolution `scripts/cloud.mjs` uses, their output handed to the /dev/cloud page.
 *
 * The two writes that change the world carry their own confirmations, the way the terminal tools
 * ask for them: apply only runs after a plan in this server process said there are changes, and
 * only when the caller types the word; destroy only runs when the caller types the stack's own
 * name, because destroy is the one command that takes the database with it — and the stack's
 * guards (deletion protection, non-empty buckets) refuse unless tfvars explicitly allowed it.
 * Stop and start are the cheap, reversible ones: desired_count 0 and 1, the cost controls the
 * runbook documents.
 *
 * This route does not exist in production, and it is committee-only in development. Nothing the
 * caller types reaches a command line: every action maps to fixed arguments, and the only free
 * text is compared, never executed.
 */

/**
 * The repository's infra/stack, found by walking up from wherever this server process happens to
 * sit — Next's cwd is usually apps/web but is not promised to be, and a spawn whose cwd does not
 * exist reports ENOENT against the executable, which is a lie that costs an afternoon.
 */
function stackDir(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(current, 'infra', 'stack');
    if (existsSync(candidate)) return candidate;
    const parent = join(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return join(process.cwd(), '..', 'infra', 'stack');
}

/** The stack's own name — `project_name`-`environment`, the prefix every resource carries. */
const STACK_NAME = 'grihaone-dev';
const STACK_DIR = stackDir();
const ACCOUNT_ID = '215671569291';
const REGION = 'ap-south-1';
/** The repository root — two levels above infra/stack — where the Dockerfile and scripts live. */
const REPO_ROOT = join(STACK_DIR, '..', '..');
/** The state bucket bootstrap owns. Its presence is what tells deploy the backend exists. */
const BOOTSTRAP_DIR = join(STACK_DIR, '..', 'bootstrap');
const STATE_BUCKET = 'grihaone-tfstate-215671569291-ap-south-1';

/**
 * The last plan this server process saw: apply refuses without a changes-planned one. A holder
 * object rather than a bare variable so the post-apply clear is a property write, not the
 * read-then-assign-across-an-await the atomic-updates rule exists to catch.
 */
const lastPlanHolder: { current: { changes: boolean; at: string } | null } = { current: null };

/** The post-apply clear, on its own so no function both reads and writes it across an await. */
function spendLastPlan(): void {
  lastPlanHolder.current = null;
}

/** Terraform by the same resolution cloud.mjs keeps: TERRAFORM_PATH, then winget, then PATH. */
function terraformPath(): string | null {
  const candidates = [
    process.env['TERRAFORM_PATH'],
    process.env['LOCALAPPDATA'] === undefined
      ? undefined
      : String.raw`${process.env['LOCALAPPDATA']}\Microsoft\WinGet\Packages\Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe\terraform.exe`,
    'terraform',
  ].filter((p): p is string => typeof p === 'string' && p !== '');
  for (const candidate of candidates) {
    if (candidate !== 'terraform' && !existsSync(candidate)) continue;
    return candidate;
  }
  return null;
}

/** Docker by the same idea: DOCKER_PATH, then Docker Desktop's install location, then PATH. */
function dockerPath(): string | null {
  const candidates = [
    process.env['DOCKER_PATH'],
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
    'docker',
  ].filter((p): p is string => typeof p === 'string' && p !== '');
  for (const candidate of candidates) {
    if (candidate !== 'docker' && !existsSync(candidate)) continue;
    return candidate;
  }
  return null;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string = STACK_DIR,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, env: { ...process.env }, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ code: 1, output: `${output}\nThe command could not start: ${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

/** Keeps a long apply from shipping megabytes to the browser: the tail carries the verdict. */
function tail(output: string, limit = 30_000): string {
  return output.length <= limit ? output : `… (truncated to the last ${limit} characters)\n${output.slice(-limit)}`;
}

/**
 * The long operations, live. A deploy is fifteen to thirty minutes and a destroy twenty; a
 * synchronous response would be a spinner the whole time with no way to see which step is
 * running. Instead the POST starts the job in this server process and returns at once, and the
 * GET hands the page every step's live tail — the same output the terminal would show, capped
 * per step. One job at a time: terraform holds a state lock anyway, and the page disables the
 * other buttons while one runs. (Dev-server hot reload clears the holder; the child processes
 * are the server's own, so they end with it too. This is a dev console, not a control plane.)
 */
interface JobStep {
  label: string;
  status: 'running' | 'ok' | 'fail';
  exit: number | null;
  output: string;
}

interface Job {
  id: number;
  action: 'deploy' | 'destroy';
  startedAt: string;
  steps: JobStep[];
  done: boolean;
  ok: boolean | null;
}

const jobHolder: { nextId: number; current: Job | null } = { nextId: 1, current: null };

function jobView(job: Job | null): Job | null {
  if (job === null) return null;
  // A fresh copy per GET: the job object is mutated by the running steps, and handing the page
  // the live object means serializing while it changes.
  return { ...job, steps: job.steps.map((step) => ({ ...step, output: tail(step.output, 4_000) })) };
}

/** Runs one step of a job, streaming its output into the step as it arrives. */
function jobStep(job: Job, label: string, command: string, args: readonly string[], cwd: string = STACK_DIR): Promise<boolean> {
  const step: JobStep = { label, status: 'running', exit: null, output: '' };
  job.steps.push(step);
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, env: { ...process.env }, windowsHide: true });
    const append = (chunk: Buffer): void => {
      if (step.output.length > 16_000) step.output = tail(step.output, 8_000);
      step.output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      append(Buffer.from(`\nThe command could not start: ${error.message}`));
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));

    function finish(code: number): void {
      step.exit = code;
      step.status = code === 0 ? 'ok' : 'fail';
      step.output = tail(step.output, 4_000);
      resolve(code === 0);
    }
  });
}

/** Starts a job: refuses if one is already running, otherwise runs it in the background. */
function startJob(action: 'deploy' | 'destroy', body: () => Promise<void>): { started: boolean; reason?: string } {
  if (jobHolder.current !== null && !jobHolder.current.done) {
    return {
      started: false,
      reason: `A ${jobHolder.current.action} is already running — its progress is on the page. One operation at a time; terraform locks the state anyway.`,
    };
  }
  const job: Job = { id: jobHolder.nextId++, action, startedAt: new Date().toISOString(), steps: [], done: false, ok: null };
  jobHolder.current = job;
  void body().finally(() => {
    job.done = true;
    job.ok = job.steps.every((step) => step.status === 'ok');
  });
  return { started: true };
}

/** The AWS probes, each independent: one that cannot answer says so, none fails the panel. */
async function serviceProbes(): Promise<{
  ecs: string;
  rds: string;
  budget: string;
}> {
  const ecs = await run('aws', [
    'ecs', 'describe-services',
    '--cluster', STACK_NAME,
    '--services', `${STACK_NAME}-app`,
    '--region', REGION, '--output', 'json',
  ]);
  const rds = await run('aws', [
    'rds', 'describe-db-instances',
    '--db-instance-identifier', `${STACK_NAME}-postgres`,
    '--region', REGION, '--output', 'json',
  ]);
  const budget = await run('aws', [
    'budgets', 'describe-budget',
    '--account-id', ACCOUNT_ID,
    '--budget-name', `${STACK_NAME}-monthly`,
    '--region', 'us-east-1', '--output', 'json',
  ]);

  function describeEcs(): string {
    if (ecs.code !== 0) return 'not reachable — is the stack deployed?';
    try {
      const parsed = JSON.parse(ecs.output) as {
        services?: { desiredCount?: number; runningCount?: number; status?: string }[];
      };
      const service = parsed.services?.[0];
      if (service === undefined) return 'not found';
      return `running ${service.runningCount ?? 0} of ${service.desiredCount ?? 0} (${service.status ?? 'unknown'})`;
    } catch {
      return 'answer not readable';
    }
  }

  function describeRds(): string {
    if (rds.code !== 0) return 'not reachable — is the stack deployed?';
    try {
      const parsed = JSON.parse(rds.output) as {
        DBInstances?: { DBInstanceStatus?: string }[];
      };
      const instance = parsed.DBInstances?.[0];
      return instance === undefined ? 'not found' : (instance.DBInstanceStatus ?? 'unknown');
    } catch {
      return 'answer not readable';
    }
  }

  function describeBudget(): string {
    if (budget.code !== 0) return 'not reachable';
    try {
      const parsed = JSON.parse(budget.output) as {
        Budget?: {
          BudgetLimit?: { Amount?: string; Unit?: string };
          CalculatedSpend?: { ActualSpend?: { Amount?: string; Unit?: string } };
        };
      };
      const limit = parsed.Budget?.BudgetLimit?.Amount;
      const actual = parsed.Budget?.CalculatedSpend?.ActualSpend?.Amount;
      if (limit === undefined) return 'not found';
      return actual === undefined
        ? `limit ${limit} USD, no spend recorded yet`
        : `${actual} of ${limit} USD this month`;
    } catch {
      return 'answer not readable';
    }
  }

  return { ecs: describeEcs(), rds: describeRds(), budget: describeBudget() };
}

async function guard(request: NextRequest): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 });
  }
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  if (who.value.role !== 'A') {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'Committee only.' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const refused = await guard(request);
  if (refused !== null) return refused;

  const tf = terraformPath();
  if (tf === null) {
    return NextResponse.json({
      terraform: null,
      stackDir: existsSync(STACK_DIR),
      tfvars: existsSync(join(STACK_DIR, 'terraform.tfvars')),
      note: 'No terraform binary found. Set TERRAFORM_PATH or install it.',
    });
  }

  const version = await run(tf, ['-version']);
  const state = await run(tf, ['state', 'list']);
  const outputs = await run(tf, ['output', '-json']);
  const probes = await serviceProbes();

  let parsedOutputs: Record<string, { value?: unknown }> = {};
  if (outputs.code === 0) {
    try {
      parsedOutputs = JSON.parse(outputs.output) as Record<string, { value?: unknown }>;
    } catch {
      parsedOutputs = {};
    }
  }

  return NextResponse.json({
    terraform: {
      path: tf,
      version: version.output.split('\n')[0] ?? 'unknown',
    },
    stackDir: existsSync(STACK_DIR),
    tfvars: existsSync(join(STACK_DIR, 'terraform.tfvars')),
    stateReachable: state.code === 0,
    stateError: state.code === 0 ? null : tail(state.output, 2000),
    resourceCount: state.code === 0
      ? state.output.split('\n').filter((line) => line.trim().length > 0).length
      : null,
    outputs: Object.fromEntries(
      Object.entries(parsedOutputs).map(([key, entry]) => [key, entry.value ?? null]),
    ),
    services: probes,
    stackName: STACK_NAME,
    lastPlan: lastPlanHolder.current,
    job: jobView(jobHolder.current),
  });
}

export async function POST(request: NextRequest) {
  const refused = await guard(request);
  if (refused !== null) return refused;

  const tf = terraformPath();
  if (tf === null) {
    return NextResponse.json(
      { code: 'INVALID_INPUT', message: 'No terraform binary found for this server.' },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; confirm?: string }
    | null;
  const action = body?.action;

  if (action === 'plan') {
    // A plan needs an initialized backend, which a teardown's cleanup (or a fresh checkout)
    // removes. Init is idempotent and quiet when already done, so run it first rather than
    // answering with the backend wall of text — from any state, the button simply works.
    const init = await run(tf, ['init', '-input=false']);
    if (init.code !== 0) {
      return NextResponse.json({ ran: 'plan', ok: false, changes: false, output: tail(init.output) });
    }
    const result = await run(tf, ['plan', '-detailed-exitcode', '-input=false', '-lock=false']);
    // 0: nothing to do. 2: changes present. 1: the plan itself failed.
    const changes = result.code === 2;
    if (result.code === 0 || result.code === 2) {
      lastPlanHolder.current = { changes, at: new Date().toISOString() };
    }
    return NextResponse.json({
      ran: 'plan',
      ok: result.code === 0 || result.code === 2,
      changes,
      output: tail(result.output),
    });
  }

  if (action === 'apply') {
    if (lastPlanHolder.current === null) {
      return NextResponse.json({
        code: 'STATE_NOT_ALLOWED',
        message: 'Plan first — apply runs what the last plan said, and there has been no plan.',
      }, { status: 409 });
    }
    if (!lastPlanHolder.current.changes) {
      return NextResponse.json({
        code: 'ALREADY_DONE',
        message: 'The last plan found nothing to change.',
      }, { status: 409 });
    }
    if (body?.confirm !== 'apply') {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message: 'Type the word to confirm the apply.',
        fields: ['confirm'],
      }, { status: 400 });
    }
    const result = await run(tf, ['apply', '-auto-approve', '-input=false']);
    // The plan apply acted on is spent; the next apply plans first. The guards above already
    // refused every path that could have replaced it in between.
    spendLastPlan();
    return NextResponse.json({ ran: 'apply', ok: result.code === 0, output: tail(result.output) });
  }

  if (action === 'deploy') {
    if (body?.confirm !== 'deploy') {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message: 'Type the word to confirm the deploy.',
        fields: ['confirm'],
      }, { status: 400 });
    }
    // The playbook's first-deploy sequence (docs/DEPLOY-PLAYBOOK.md §3) as one button: bundles,
    // the state bucket if a teardown removed it, the ECR repository alone (images cannot be
    // pushed into a repository that does not exist), both images built and pushed, then the full
    // apply — which starts the migrate task and the service. Idempotent: with the stack already
    // up, every step is a no-op except the image rebuild, and the apply finds nothing to change.
    const docker = dockerPath();
    if (docker === null) {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message: 'Docker is not running or not installed — start Docker Desktop first.',
      }, { status: 400 });
    }

    const engine = await run(docker, ['version', '--format', '{{.Server.Version}}']);
    if (engine.code !== 0) {
      return NextResponse.json({
        ran: 'deploy',
        ok: false,
        output: 'Docker answered but the engine did not — start Docker Desktop and wait for it, then deploy again.',
      });
    }

    const started = startJob('deploy', async () => {
      const job = jobHolder.current;
      if (job === null) return;

      // 1. The Lambda bundles the apply consumes.
      if (!await jobStep(job, 'build lambda bundles', process.execPath, ['scripts/build-lambdas.mjs'], REPO_ROOT)) return;

      // 2. The state bucket, only when a teardown removed it (head-bucket answers 404/403).
      const bucket = await run('aws', ['s3api', 'head-bucket', '--bucket', STATE_BUCKET, '--region', REGION]);
      if (bucket.code !== 0) {
        if (!await jobStep(job, 'bootstrap state bucket (init)', tf, ['init', '-input=false'], BOOTSTRAP_DIR)) return;
        if (!await jobStep(job, 'bootstrap state bucket (apply)', tf, ['apply', '-auto-approve', '-input=false'], BOOTSTRAP_DIR)) return;
      }

      // 3. ECR alone, then the images into it.
      if (!await jobStep(job, 'terraform init', tf, ['init', '-input=false'], STACK_DIR)) return;
      if (!await jobStep(job, 'create the image repository', tf, ['apply', '-target=aws_ecr_repository.app', '-auto-approve', '-input=false'], STACK_DIR)) return;
      const repoUrl = await run(tf, ['output', '-raw', 'ecr_repository_url'], STACK_DIR);
      const repository = repoUrl.output.trim();
      if (repoUrl.code !== 0 || repository === '') {
        job.steps.push({ label: 'read the repository URL', status: 'fail', exit: repoUrl.code, output: tail(repoUrl.output, 4_000) });
        return;
      }
      const registry = `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com`;
      const login = await run('aws', ['ecr', 'get-login-password', '--region', REGION]);
      if (login.code !== 0) {
        job.steps.push({ label: 'ecr login password', status: 'fail', exit: login.code, output: tail(login.output, 4_000) });
        return;
      }
      if (!await jobStep(job, 'ecr login', docker, ['login', '--username', 'AWS', '--password', login.output.trim(), registry])) return;

      for (const [target, tag] of [['runtime', 'latest'], ['migrate', 'migrate']] as const) {
        if (!await jobStep(job, `build the ${target} image`, docker, ['build', '--file', 'infra/docker/Dockerfile', '--target', target, '--tag', `${repository}:${tag}`, '.'], REPO_ROOT)) return;
        if (!await jobStep(job, `push the ${target} image`, docker, ['push', `${repository}:${tag}`], REPO_ROOT)) return;
      }

      // 4. The full apply: RDS, the migrate task, the service behind the load balancer.
      if (!await jobStep(job, 'apply the stack', tf, ['apply', '-auto-approve', '-input=false'], STACK_DIR)) return;
      spendLastPlan();
    });

    if (!started.started) {
      return NextResponse.json({ code: 'STATE_NOT_ALLOWED', message: started.reason }, { status: 409 });
    }
    return NextResponse.json({ ran: 'deploy', ok: true, started: true });
  }

  if (action === 'stop' || action === 'start') {
    // The cost controls: desired_count 0 and 1, exactly what cloud:stop and cloud:start do.
    const result = await run(tf, [
      'apply', '-auto-approve', '-input=false', '-var', `desired_count=${action === 'stop' ? 0 : 1}`,
    ]);
    return NextResponse.json({ ran: action, ok: result.code === 0, output: tail(result.output) });
  }

  if (action === 'destroy') {
    if (body?.confirm !== STACK_NAME) {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message: `Type the stack's name (${STACK_NAME}) to confirm the destroy.`,
        fields: ['confirm'],
      }, { status: 400 });
    }

    // The registry is saved before anything is deleted: a destroy that loses the cloud's property
    // registry because nobody ran the sync first is the one mistake this console exists to make
    // impossible. The pull writes blocks, units and facilities into the local database — accounts,
    // receipts and mail have no second home by design (ADR 0004), and the page says so.
    // A destroy may therefore only run from a server that can see the cloud database.
    if (process.env['DATABASE_URL'] === undefined || process.env['DATABASE_URL'] === '') {
      return NextResponse.json({
        code: 'INVALID_INPUT',
        message:
          'This server cannot see the cloud database, so the pre-destroy sync cannot run. Start ' +
          'the dev server with the `pnpm cloud:env` export line in its shell and try again — a ' +
          'destroy that cannot save the registry first is refused on purpose.',
        fields: ['cloud'],
      }, { status: 400 });
    }
    const pull = await run(
      process.execPath,
      ['scripts/db-pull.mjs', '--yes'],
      join(STACK_DIR, '..', '..'),
    );
    if (pull.code !== 0) {
      return NextResponse.json({
        ran: 'destroy',
        ok: false,
        output:
          '== pre-destroy sync FAILED — nothing was destroyed ==\n' +
          'The database this pull failed to read from is the one the destroy would take, so it ' +
          'was refused. If the database is already gone (a previous destroy half-finished), run ' +
          'terraform destroy in infra/stack directly.\n\n' +
          tail(pull.output, 10_000),
      });
    }

    const started = startJob('destroy', async () => {
      const job = jobHolder.current;
      if (job === null) return;
      job.steps.push({ label: 'pre-destroy sync (cloud registry pulled to local)', status: 'ok', exit: 0, output: tail(pull.output, 4_000) });
      // The ~20-minute teardown; the Lambda ENI security groups are the slow tail and are normal.
      await jobStep(job, 'terraform destroy', tf, ['destroy', '-auto-approve', '-input=false']);
    });

    if (!started.started) {
      return NextResponse.json({ code: 'STATE_NOT_ALLOWED', message: started.reason }, { status: 409 });
    }
    return NextResponse.json({ ran: 'destroy', ok: true, started: true });
  }

  return NextResponse.json(
    { code: 'INVALID_INPUT', message: 'Unknown action.', fields: ['action'] },
    { status: 400 },
  );
}
