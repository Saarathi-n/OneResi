# Runbook

The operating detail behind the README: every root script with its arguments, the environment
variables the apps and workers read, the mail outbox and its retry behaviour, the seed and how to
reset local data, and fixes for the failures you are most likely to hit. Commands are copy-paste
ready.

## Scripts

### Setup

```bash
pnpm install        # the one install; bootstrap deliberately installs nothing itself
pnpm bootstrap      # generate both Prisma clients, migrate the local file, seed it, print accounts
```

`pnpm bootstrap` is idempotent. Run it after pulling a migration, after switching branches, or
whenever the local database looks wrong. It refuses to run before `pnpm install` and says so. It
never talks to the network beyond what `pnpm install` already downloaded.

### Database

The database scripts live in `packages/db` and are re-exported at the root. Every one of them
targets whichever database `DB_TARGET` names — `local` (the default) or `cloud` — and the wrapper
(`packages/db/scripts/prisma.mjs`) prints the target it resolved before doing anything.

```bash
pnpm db:generate      # regenerate the two schema variants and both Prisma clients from the base schema
pnpm db:migrate       # apply every pending migration (prisma migrate deploy)
pnpm db:seed          # seed the target database; convergent, safe to re-run
pnpm db:reset         # drop and recreate every table on the target, then re-apply migrations. Destructive.
pnpm db:checksum      # print a SHA-256 content digest of the target, table by table
pnpm db:studio        # open Prisma Studio against the target
```

`db:generate` must run before anything typechecks: the Prisma clients are build output, not
committed, and `packages/db/src` imports both of them (the PostgreSQL one for its types even when
SQLite is the live target). `pnpm bootstrap` runs it for you.

For authoring a new migration there is a package-level script the root does not re-export:

```bash
pnpm --filter @oneresi/db migrate:dev
```

### Local and cloud sync

Three scripts in `scripts/`, all of which take the cloud side from `DATABASE_URL` and the local side
from `LOCAL_DB_FILE` (default `.data/oneresi.db`). They move the property registry — blocks, units
and facilities — and nothing else. Accounts, sessions, tokens, notifications, receipts and outbox
rows have no second home and are never read or written by a sync.

```bash
pnpm db:diff                                     # read-only: row counts per table, plus a natural-key
                                                 # diff of the property registry. Always safe.
pnpm db:pull                                     # cloud -> local: print the plan, ask, write
pnpm db:pull --dry-run                           # print the plan, write nothing
pnpm db:pull --yes                               # do not ask (required when stdin is not a terminal)
pnpm db:push                                     # local -> cloud: plan only, the default
pnpm db:push --execute                           # plan, ask, then actually write
pnpm db:push --execute --yes                     # plan and write without asking
```

Flags accepted by each (anything else is an error, and `--help` prints the same list):

| Flag | `db:diff` | `db:pull` | `db:push` | Meaning |
|---|---|---|---|---|
| `--dry-run` | accepted, a diff is always dry | plan only, write nothing | accepted for symmetry | Write nothing |
| `--execute` | — | — | actually write, after confirmation | The only way a push writes |
| `--yes` | — | skip the confirmation | skip the confirmation | For non-interactive shells |
| `--allow-local` | yes | yes | yes | Permit a `DATABASE_URL` that points at this machine |

The localhost guard: a cloud URL that resolves to this machine is refused with an explanation,
because it is almost always the wrong terminal with the wrong export line and the cost of finding
out after the write is a rebuilt database. `--allow-local` states that a second local database is
deliberately standing in for the cloud one — which is also how these scripts are tested.

A remote `DATABASE_URL` must be a PostgreSQL URL carrying `sslmode=`, matching the boot-time check in
`packages/db/src/env.ts`.

After every write, both directions re-read the source and the target and verify that every registry
row converges; a mismatch is printed and the exit code is 1. Rows that exist only on the receiving
side are reported and left alone — removing a property row that invoices point at is a decision, not
a side effect.

### Cloud

Wrappers around Terraform and the AWS CLI — every one ends in a command you could have typed
yourself. All of them need the stack to exist and AWS credentials to be configured; none of them is
run by CI.

```bash
pnpm cloud:up      # terraform apply, then print the app URL
pnpm cloud:down    # terraform destroy
pnpm cloud:stop    # desired_count 0 — keeps everything, stops the only continuous meter
pnpm cloud:start   # desired_count 1
pnpm cloud:env     # print the export line for DATABASE_URL (from stack outputs + Secrets Manager)
```

`cloud:env` output looks like this; paste it into one shell and the sync scripts and `DB_TARGET=cloud`
will use it:

```bash
export DATABASE_URL='postgresql://...@...ap-south-1.rds.amazonaws.com/oneresi?sslmode=require'
export DB_TARGET=cloud
```

Terraform is invoked by full path on purpose: a stale 1.9.8 in `~/bin` can shadow the installed
1.15.8 on PATH. Set `TERRAFORM_PATH` to override the binary location if your PATH situation is
different.

### Static checks and gates

```bash
pnpm typecheck       # tsc over the test config, then a project build of every package
pnpm lint            # eslint over the repository
pnpm format          # prettier --write .
pnpm format:check    # prettier --check .

pnpm check:copy      # no requirement identifiers or placeholder framing in user-visible strings
pnpm check:enums     # no raw enumeration values rendered into the DOM; labels come from contracts
pnpm check:gates     # both gates with --self-test: proves each scanner can still fail
pnpm verify          # typecheck + lint + both gates + parity, in one command
```

The two gates scan only what a user reads (app source, the design system, mail templates), after
comments are stripped — citing a decision record in a code comment is fine; putting one on a button
is not. `node scripts/check-enums.mjs --list` prints exactly what that gate scans for.

### Tests

```bash
pnpm test                          # vitest run, every suite, against the local SQLite target
pnpm test packages/domain          # one subset
pnpm test:watch                    # vitest watch mode
pnpm test:parity                   # the same suite twice: SQLite, then PostgreSQL if it can
pnpm test:parity packages/db       # a subset, still on both engines
pnpm test:mail:live                # sends one real email; needs the deployed stack
```

Run one suite at a time. The global setup (`test/global-setup.ts`) builds a shared SQLite template
at `.data/test/template.db` before any test file runs, and every test file takes an isolated copy of
that one file. Two vitest runs at once would rebuild the template out from under each other. CI
obeys the same rule by running its suites as separate jobs on separate runners.

The PostgreSQL half of the parity run needs a throwaway database, named by `TEST_DATABASE_URL`:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm test:parity
```

Without `TEST_DATABASE_URL` the cloud half is skipped with a notice and the run still succeeds — CI
supplies the container on every pull request. Use a throwaway database, never a real one: each test
file takes its own schema and drops it afterwards.

`test:mail:live` asserts that one message actually left AWS — a SEND event and a DELIVERY event on
the SQS queue the SES configuration set publishes to, and no bounce or complaint. It needs
`AWS_REGION` (or `AWS_DEFAULT_REGION`), `MAIL_PROBE_TO`, `MAIL_FROM`, `SES_CONFIGURATION_SET` and
`SES_EVENT_QUEUE_URL`; `scripts/mail-live.mjs` documents where each one comes from (the stack
outputs). Until SES leaves the sandbox, `MAIL_PROBE_TO` must be a verified address as well.

## Environment variables

Where `.env` files are read: the two Next.js apps load `.env` / `.env.local` from their own
directories (`apps/web`, `apps/app`). The root scripts — bootstrap, the sync scripts, the parity
runner — read the shell environment only and ignore `.env` files entirely. Export values in the
shell for those, or put app-only values in `apps/web/.env.local`.

Nothing is set for local development. The default configuration — `DB_TARGET=local`, no
`DATABASE_URL`, no `JWT_SECRET` — runs the whole system against the SQLite file. The variables below
are what you set when you step outside that.

### Database target

| Variable | Values | What it decides |
|---|---|---|
| `DB_TARGET` | `local` (default) \| `cloud` | Which database is live. One target, chosen at boot, never failover. |
| `DATABASE_URL` | PostgreSQL URL | The cloud side. Required when `DB_TARGET=cloud` and by all three sync scripts; must be a PostgreSQL URL carrying `sslmode=require`. |
| `LOCAL_DB_FILE` | path | The SQLite file. Default `.data/oneresi.db`. The sync scripts accept it to point at a different local file. |
| `TEST_DATABASE_URL` | PostgreSQL URL | The throwaway database for the PostgreSQL half of the parity run. |

### Applications

| Variable | What it is |
|---|---|
| `JWT_SECRET` | The session signing key. In development an unset value falls back to a random per-process secret. In production it must be set, at least 32 bytes, or boot fails — there is no fallback. |
| `APP_ORIGIN` | The origin every link in an email is built from (for example `https://app.example.in`). No default in any environment: mail cannot render without it. Must be https in production. |
| `NEXT_PUBLIC_API_BASE` | `apps/app` only. Where the API lives. Defaults to `http://localhost:3000` in development and same-origin (empty) in the deployed build. |

### Mail

| Variable | What it is |
|---|---|
| `EMAIL_DRIVER` | `console` (default outside production) or `ses`. Production must say `ses` explicitly — the console provider writes a row and a log line and delivers nothing. |
| `MAIL_FROM` | The sending identity, required whenever the driver is `ses`; must be verified in SES for the region. |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | The region SES identities live in. SES identities are per region; a laptop defaulting to the wrong one is how an identity gets verified in the wrong place. |
| `SES_CONFIGURATION_SET` | Created by Terraform; its event destination publishes delivery events to SNS and SQS. |
| `SES_EVENT_QUEUE_URL` | The queue those events land in; read by the live mail suite. |

### Seed and tooling

| Variable | What it is |
|---|---|
| `SEED_PASSWORD` | The password the seed assigns the accounts. Default is a generated value, printed by the seed; set this to choose your own. |
| `TERRAFORM_PATH` | Overrides where `scripts/cloud.mjs` finds the terraform binary, for machines where PATH resolves to a stale version. |
| `NODE_ENV` | Set to `production` in deploy. Triggers the strict boot checks described above. |

## The mail outbox worker

A handler that changes something a resident should hear about writes an `outbox_event` row inside
the same database transaction as the change and returns — it never calls SES and never loops over
recipients, so the billing run for the whole society is one transaction and one response, not
hundreds of serial mail round-trips. Locally an in-process worker drains the outbox every five
seconds; in deploy the same drain function runs in a Lambda invoked once per SQS batch — same code,
same contract. Before sending, a row is claimed by a conditional update on its own attempt count, so
two workers (or a worker and its own retry) can never send one message twice; a claim holds for
sixty seconds, and a worker that dies mid-send leaves the row to return when the lease expires,
having spent one attempt. Failures are transient by default and retry with exponential backoff —
fifteen seconds doubling to a fifteen-minute cap, with plus-or-minus twenty percent jitter so two
workers that failed together do not come back in lockstep. After five attempts a row is marked
FAILED and stops retrying, waiting for a person; the requeue path (`requeueFailed`, what a resend
button calls) puts FAILED rows back at one extra attempt a time. A failure that is permanent — a
payload that will never parse, a template that does not exist, an address the provider has rejected
outright — abandons the row immediately with the reason on it, because a poison row that keeps
coming back hides everything queued behind it; after eight attempts a row is ABANDONED and never
tried again by anything. The worker never throws into a caller: every failure, including the
database being down, comes back as a value in a report.

The worker only drains `channel = 'EMAIL'` rows. Every message that was ever sent, attempted or
abandoned is a database row, which is what the mail test suite asserts against.

## The seed, and resetting local data

`pnpm db:seed` is convergent: every write is an upsert on a natural key with an empty update branch,
so running it twice changes nothing — not row counts and not the content digest (`pnpm db:checksum`
is the gate for that, and it is how the seed proves it does not rewrite `passwordHash` or bump
`updatedAt` on every run). It creates:

- Three blocks (Emerald, Sapphire, Gulmohar Phase 1) and seven units across them, each with a
  monthly charge.
- Five accounts sharing one password (set via `SEED_PASSWORD`, otherwise generated and printed):
  committee, gate, two residents with status ACTIVE, and one resident with status PENDING so the
  registration queue has an application to decide.
- Three bookable facilities (clubhouse, badminton, tennis) with hourly rates.
- One invoice per unit for the previous period (PAID, with a payment and a receipt number) and one
  for the current period (UNPAID).

The seed prints the three sign-in accounts and the password when it finishes. It runs against
whichever target `DB_TARGET` names, which is how the cloud deploy seeds RDS.

To get back to a known state — no half-converged rows, no orphaned outbox events from an interrupted
run:

```bash
pnpm db:reset       # drops and recreates every table and the migration history, then re-applies migrations
pnpm db:seed        # the seed is an explicit second command; reset does not run it
```

`db:reset` is destructive on purpose and prints the target before dropping anything. Against the
cloud target it wipes RDS just as thoroughly as it wipes the local file — the same one-target rule
as every other script in the package. The nuclear option for local data is simply deleting
`.data/oneresi.db` and running `pnpm bootstrap` again.

## Troubleshooting

**There is no root `pnpm dev` script — the front ends start individually.**

```bash
pnpm --filter @oneresi/web dev
pnpm --filter @oneresi/app dev
```

**Port 3000 or 3001 already in use.** Both dev servers take fixed ports, and `apps/app` assumes the
API is on 3000. Find what holds the port and stop it, or point the app at a different API with
`NEXT_PUBLIC_API_BASE`. On Windows: `netstat -ano | findstr :3000`, then end the listed PID.

**`Dependencies are not installed: ... cannot be resolved`** (from bootstrap). Run `pnpm install`.
Bootstrap deliberately installs nothing — one install, done on purpose, is what keeps the lockfile
from being rewritten by parallel streams.

**Type errors mentioning `packages/db/prisma/generated/...` or `@prisma/client` types.** The two
Prisma clients are generated build output and are not committed. Run `pnpm bootstrap` — after
pulling a migration, after switching branches, or whenever these errors appear.

**`DB_TARGET=cloud but DATABASE_URL is not set`** — the process refused to boot rather than
silently serving local data. Get the URL from `pnpm cloud:env` (needs the deployed stack), or unset
`DB_TARGET` to work locally.

**`The cloud DATABASE_URL must specify sslmode=require.`** Add `?sslmode=require` to the URL (or
`&` if it already has a query). This matches the check the sync scripts apply to `DATABASE_URL`.

**A sync refuses the URL: "points at this machine".** The localhost guard. Either the wrong export
line is in the shell, or a second local database is genuinely standing in for the cloud one — in
which case pass `--allow-local`.

**`db:push` printed a plan but wrote nothing.** That is the design: a push is a dry run unless
`--execute` is passed, and even then it asks unless `--yes` is given.

**Tests fail in ways that mention `template.db`, or a suite hangs at startup.** Almost always two
vitest runs racing on the same template. Run one suite at a time. A leftover or locked
`.data/test/` directory (Windows can hold the SQLite handle briefly) is rebuilt from scratch on the
next run; delete it if you want to be sure.

**Mail rows sit PENDING forever locally, with `MailConfigError` in `lastError`.** `APP_ORIGIN` is
not set. A missing configuration is treated as transient — the row keeps its attempts and retries —
so nothing is lost; export `APP_ORIGIN=http://localhost:3000` and restart, and the backlog renders
and delivers through the console provider (it writes the rendered message to the log and the
`mail_message` row, and delivers nothing outside the machine).

**Terraform fails with "Unsupported Terraform Core version".** A stale 1.9.8 earlier on PATH
shadows the installed 1.15.8. Either fix PATH, or set `TERRAFORM_PATH` to the full path of the
newer binary; `scripts/cloud.mjs` already probes the standard winget location first.

**`pnpm install` produced broken native packages.** pnpm 11 blocks postinstall scripts unless a
package is allow-listed; `pnpm-workspace.yaml` lists the ones this repository needs (prisma, esbuild,
sharp, unrs-resolver). If a platform binary is missing, check that file was not reverted.

**Node version complaints (`import.meta.dirname` is not defined, or bootstrap refuses the version).**
The workspace needs Node 20.11 or newer. `nvm install 22 && nvm use 22`, or install a current LTS.
