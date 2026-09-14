import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { actor, toResponse } from '@/server/http';
import { resolveCloudDatabaseUrl } from '@/server/cloud-db';

/**
 * The local↔cloud bridge, behind a dev-only route: it runs the repository's own sync commands
 * (db-diff, db-pull, db-push — the same scripts `pnpm db:diff` runs, over the same lib, ADR 0004)
 * and hands their output to the /dev/sync page.
 *
 * This route does not exist in production: on AWS the property registry's home is RDS and there
 * is no local file to bridge to, so the route refuses before anything is read. In development it
 * is committee-only — the person who owns the society's data is the person who syncs it.
 *
 * What the commands move is the property registry and nothing else: blocks, units and their
 * charges, and the facilities. Accounts, sessions, receipts and the outbox are per-database
 * state with no second home — credentials and queued mail are not property. The page says so,
 * because a sync tool that silently did more would be the wrong kind of surprise.
 *
 * Every write is two steps in the UI, mirroring the confirmation the command-line tools ask for:
 * the page always plans first (the script's --dry-run), and only an explicit second press runs
 * the same plan with --yes. Nothing the caller types reaches a command line — the action names a
 * fixed script and fixed flags, and the only variable is the environment the server already has.
 */

/** The fixed commands this route will run, by the action the page asks for. */
const SCRIPTS = {
  diff: { file: 'db-diff.mjs', appliesFlags: ['--dry-run'] },
  pull: { file: 'db-pull.mjs', appliesFlags: ['--yes'] },
  push: { file: 'db-push.mjs', appliesFlags: ['--yes'] },
} as const;

type Action = keyof typeof SCRIPTS;

function repoRoot(): string {
  // The scripts live at the repository root, but the dev server's cwd is not promised to be
  // apps/web — `next dev` from the repo root, from apps/web, or under pnpm each land somewhere
  // else. Walk up until the scripts directory is actually there; a computed root whose scripts
  // do not exist is a MODULE_NOT_FOUND pretending to be a broken feature.
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(current, 'scripts', 'db-diff.mjs'))) return current;
    const parent = join(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return join(process.cwd(), '..', '..');
}

/** Runs one sync script and resolves its captured output and exit code. */
function runScript(
  file: string,
  flags: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(repoRoot(), 'scripts', file), ...flags], {
      cwd: repoRoot(),
      env: { ...process.env, ...env },
      windowsHide: true,
    });
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

/** The cloud URL the server can currently see, redacted to its host — never the credentials. */
async function redactedCloud(): Promise<string | null> {
  const url = (await resolveCloudDatabaseUrl()) ?? process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '(set, but not a URL the page can name)';
  }
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 });
  }
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  if (who.value.role !== 'A') {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'Committee only.' }, { status: 403 });
  }

  return NextResponse.json({
    cloud: await redactedCloud(),
    localFile: existsSync(join(repoRoot(), '.data', 'grihaone.db')),
  });
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 });
  }
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  if (who.value.role !== 'A') {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'Committee only.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { action?: string; apply?: boolean } | null;
  const action = body?.action as Action | undefined;
  if (action === undefined || !(action in SCRIPTS)) {
    return NextResponse.json(
      { code: 'INVALID_INPUT', message: 'Unknown action.', fields: ['action'] },
      { status: 400 },
    );
  }

  // The cloud URL is resolved live from AWS (RDS endpoint + Secrets Manager) — the master
  // password rotates on every stack creation, so a DATABASE_URL exported into the server's
  // shell is stale after every deploy→destroy→deploy cycle. Falls back to the server's own
  // DATABASE_URL when AWS cannot be reached (a second local database standing in for the cloud
  // one, the --allow-local arrangement the scripts document).
  const liveUrl = await resolveCloudDatabaseUrl();
  const cloudUrl = liveUrl ?? process.env['DATABASE_URL'];
  if (cloudUrl === undefined || cloudUrl.trim() === '') {
    return NextResponse.json(
      {
        code: 'INVALID_INPUT',
        message:
          'No cloud database to sync with — deploy the stack first, or export DATABASE_URL for a ' +
          'stand-in database the scripts can --allow-local.',
        fields: ['cloud'],
      },
      { status: 400 },
    );
  }

  const script = SCRIPTS[action];
  // A write only ever runs applied; the plan (dry run) is what the page shows first. The diff is
  // always dry — it writes nothing by construction.
  const flags = action === 'diff' ? script.appliesFlags : body?.apply === true ? script.appliesFlags : ['--dry-run'];

  const { code, output } = await runScript(script.file, flags, { DATABASE_URL: cloudUrl, DB_TARGET: 'cloud' });
  return NextResponse.json(
    {
      ran: action,
      applied: action !== 'diff' && body?.apply === true,
      ok: code === 0,
      output,
    },
    { status: 200 },
  );
}
