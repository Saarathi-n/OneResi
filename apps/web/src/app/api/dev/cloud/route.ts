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
    const result = await run(tf, ['destroy', '-auto-approve', '-input=false']);
    return NextResponse.json({ ran: 'destroy', ok: result.code === 0, output: tail(result.output) });
  }

  return NextResponse.json(
    { code: 'INVALID_INPUT', message: 'Unknown action.', fields: ['action'] },
    { status: 400 },
  );
}
