# OneResi

OneResi is a residential community management system for an apartment complex or gated society: one
product with three surfaces — a resident app, a committee desk, and a gate kiosk — sharing one API
and one database.

Residents see their monthly dues and invoices, pay them, download receipts, raise and track
complaints, book facilities, issue visitor passes, answer the gate when a visitor arrives, and read
notices. The committee runs the society from a desk: they review registration applications, manage
blocks and units, raise invoices for a billing period, record offline payments, work the complaint
queue, approve facility bookings, and publish notices. Gate staff work a kiosk with three jobs —
verify a visitor pass code, record an entry, log a walk-in and ask the resident to approve it.

Payment is confirmed in the app itself; the system records the payment and issues a numbered receipt
in the same transaction. There is no external payment gateway ([ADR 0002](docs/adr/0002-payment-is-simulated.md)).
Email is delivered through a transactional outbox, so a request succeeds even when mail delivery is
delayed.

## The three surfaces

| Surface | App | Dev URL | What it is |
|---|---|---|---|
| Committee desk, marketing site, every API route | `apps/web` | http://localhost:3000 | Next.js, server-rendered. `/desk/*` is the committee, `/gate` is the kiosk, `/api/**` is the whole API. |
| Resident and gate PWA | `apps/app` | http://localhost:3001/a | Installable Next.js PWA under the `/a` base path. Calls the API cross-origin in dev. |

In deploy, both apps are built into one container image: `/` and `/desk/*` are served from `web`,
`/a/*` from `app`, so the app's calls become same-origin. The full API surface — every route, its
contract, and who may call it — is in [docs/plan/07-api-route-map.md](docs/plan/07-api-route-map.md).

## Workspace layout

```
apps/
  web/          Marketing site, committee desk, gate kiosk, all API routes (port 3000)
  app/          Installable PWA: residents and the gate (port 3001, base path /a)
packages/
  contracts/    Zod schemas, TypeScript types, enumerations and their labels. The only
                definition of any payload. Money is integer paise everywhere.
  domain/       Use-case services. No HTTP, no React, no queries inline.
  db/           Prisma schema, migrations, seed, both target adapters, checksum.
  ui/           Design system: tokens, primitives, motion.
  mail/         Templates, renderer, providers, the outbox worker.
infra/
  bootstrap/    The Terraform state bucket. Applied once, with local state.
  stack/        Everything else: network, RDS, ECS, SES, Lambda, budgets.
scripts/        Bootstrap, database sync, cloud wrappers, gates, the parity runner.
docs/           Plan, architecture, data model, decision records, this runbook.
```

Handlers authenticate, parse a request with a contract, call one domain service, and map the result
to a response. All business rules live in `packages/domain`; all queries live in `packages/db`.

## Quickstart

Prerequisites: Node 20.11 or newer (CI runs Node 24) and pnpm 11 (`packageManager` pins
`pnpm@11.13.1`). That is the whole list — no PostgreSQL, no Docker, no AWS account, no `.env` file.
Local development runs against a SQLite file with the real schema and the real migrations.

```bash
git clone <this repository>
cd oneresi
pnpm install
pnpm bootstrap
```

`pnpm bootstrap` is idempotent and does four things: generates the two Prisma clients from the one
base schema, applies every migration to `.data/oneresi.db`, seeds it, and prints the sign-in
accounts. `pnpm db:migrate` and `pnpm db:seed` are the same steps individually — bootstrap runs both,
so you do not need to run them again here. Re-run bootstrap after pulling a migration or switching
branches.

Then start the two front ends, in two terminals:

```bash
pnpm --filter @oneresi/web dev    # http://localhost:3000
pnpm --filter @oneresi/app dev    # http://localhost:3001/a
```

Sign in with the accounts the bootstrap output printed (the seed's password is a fixed default
for local data, and `SEED_PASSWORD` sets a different one):

| Account | Role | What it reaches |
|---|---|---|
| `committee@oneresi.in` | Committee | The desk: registration queue, billing, complaints, bookings, notices, property |
| `gate@oneresi.in` | Gate staff | The kiosk: verify a pass, record an entry, log a walk-in |
| `saarathi@oneresi.in` | Resident | The app: dues, receipts, complaints, bookings, visitors |

Two more residents sit in the registration queue with status PENDING — `vikram@oneresi.in`, with
a live claim to a flat that is not on the register yet, and `kabir.chowdhury@gmail.com` — so the
committee's approve/decline flow has something to work on. Everyone after the first account who
registers queues the same way.

That is the whole setup. If something breaks, the [runbook](docs/runbook.md) has a troubleshooting
section for the likely failures.

## Two database targets, one schema

`packages/db/prisma/schema.base.prisma` is the only hand-edited schema. A generator emits the SQLite
and PostgreSQL variants from it, and a test asserts the two differ in nothing but the provider line.
`DB_TARGET` picks exactly one target at boot — never two, never automatic failover, because two
writable copies that silently swap produce divergence that cannot be merged afterwards
([ADR 0004](docs/adr/0004-local-and-cloud-dual-target.md)).

| | `DB_TARGET=local` (the default) | `DB_TARGET=cloud` |
|---|---|---|
| Engine | SQLite file at `.data/oneresi.db` | RDS for PostgreSQL 16 |
| Needs | nothing installed, nothing configured | `DATABASE_URL`, a PostgreSQL URL with `sslmode=require` |
| If misconfigured | — | the process refuses to start rather than serving local data |

In production the boot check is stricter: `DB_TARGET` must be `cloud`, `JWT_SECRET` must be at least
32 bytes, and `APP_ORIGIN` must be an https origin, or the process does not start.

## Local to cloud sync

Sync is a command you run, never a background behaviour. It moves the property registry — blocks,
units with their charges, and facilities — and nothing else. Accounts, sessions, tokens,
notifications, receipts and outbox rows are per-database state and are never synced in either
direction. All three commands need `DATABASE_URL` naming the cloud side; `pnpm cloud:env` prints the
export line once the stack exists.

```bash
pnpm db:diff                                  # report only, writes nothing — run this first
pnpm db:pull                                  # cloud -> local, asks before writing
pnpm db:push                                  # local -> cloud, a dry run unless --execute is passed
pnpm db:push --execute                        # plan, confirm, then write
DATABASE_URL='postgresql://...' pnpm db:diff   # how the cloud side is named
```

The safety rails, in short:

- **Dry-run by default.** A push writes nothing unless `--execute` is passed; even then it asks for
  confirmation unless `--yes` is given. A pull prints its plan first and asks; `--dry-run` writes
  nothing.
- **Localhost guard.** A `DATABASE_URL` that points back at this machine is refused, because it is
  almost always the wrong terminal with the wrong export line. `--allow-local` overrides it only
  when a second local database is deliberately standing in for the cloud one.
- **Narrow by construction.** Only blocks, units and facilities move. Upserts run by natural key
  inside one transaction, so running a sync twice moves nothing the second time, and rows that exist
  only on the receiving side are reported and left alone.
- **Verified after writing.** Each direction re-reads both sides and compares; a mismatch is listed
  and the command exits non-zero.

The operating detail — every flag, the environment variables, reset and checksum — is in the
[runbook](docs/runbook.md).

## Testing

```bash
pnpm test                                      # every unit and integration suite, SQLite target
pnpm test packages/domain                      # one subset
pnpm test:parity                               # the same suite twice: SQLite, then PostgreSQL
pnpm test:watch                                # vitest in watch mode
pnpm verify                                    # typecheck + lint + both gates + parity
```

The suites cover the domain services against in-memory stores, the database store adapters, the
schema's portability between engines, the constraint behaviour (double billing and double booking
are impossible by index), and the mail pipeline.

**Why suites run one at a time.** The global setup builds one shared SQLite template at
`.data/test/template.db` before any test file runs; every test file then takes an isolated copy. Two
vitest runs in parallel would rebuild that template out from under each other, so never run two
suites at once. CI obeys the same rule by running its suites as separate jobs on separate runners.

**The parity run.** Every integration test runs twice with the same bodies — once against SQLite,
once against PostgreSQL — and the runner compares the two result sets engine by engine, because the
defect that motivated this build was an engine that had been exercised locally but never deployed
against. Without `TEST_DATABASE_URL` the PostgreSQL half is skipped with a notice and the run still
succeeds; CI always supplies a container:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm test:parity
```

`pnpm test:mail:live` is separate and opt-in: it sends one real email through the deployed stack and
asserts the delivery events arrived. It needs AWS credentials and stack outputs; see the runbook.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and every pull
request, in three jobs:

| Job | What it runs | Why it is separate |
|---|---|---|
| `quality` | typecheck, lint, the copy and enumeration gates (with self-tests proving the gates can still fail) | No database involved. |
| `unit-domain` | `pnpm test packages/domain` | Pure logic, no database — a fast signal that does not wait on a PostgreSQL container. A separate job, not a second step, because of the shared template database: separate jobs get separate runners and separate filesystems. |
| `db-parity` | `pnpm test:parity` against a `postgres:16` service container | The parity suite is the point of this job; reports are uploaded as artifacts either way. |

Terraform and AWS are deliberately absent from CI: validating or deploying the stack needs
credentials this workflow neither has nor should have. That belongs to the infrastructure stream and
its IAM role, not to a code review gate.

## Commands

| Command | What it does |
|---|---|
| `pnpm bootstrap` | Fresh clone to working local setup: generate clients, migrate, seed, print accounts |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:reset` / `db:checksum` / `db:studio` | The database package's scripts, targeted by `DB_TARGET` (local by default) |
| `pnpm db:diff` / `db:pull` / `db:push` | Local and cloud sync, with the rails described above |
| `pnpm push:keys` | Generate the web push keypair once, for the life of the deployment |
| `pnpm cloud:up` / `cloud:down` / `cloud:stop` / `cloud:start` / `cloud:env` | Terraform and AWS wrappers for the deployed stack |
| `pnpm typecheck` / `lint` / `format` / `format:check` | Static checks |
| `pnpm check:copy` / `check:enums` / `check:gates` | The copy gate (no requirement identifiers or placeholder framing in user-visible strings) and the enumeration gate (no raw enumeration values in the DOM), plus their self-tests |
| `pnpm test` / `test:watch` / `test:parity` / `test:mail:live` | See Testing above |
| `pnpm verify` | typecheck, lint, both gates, parity — the full pre-merge check |

Every script, with its arguments and environment variables, is documented in the
[runbook](docs/runbook.md).

## Deployment status

The Terraform for the cloud deployment is written: `infra/bootstrap` provisions the state bucket
(apply once, with local state), and `infra/stack` provisions everything else — network, RDS, ECS,
SES, Lambda, budgets with alarms. Applying any of it requires AWS credentials and is gated on
authorisation; nothing in this repository or in CI applies it, and no apply has been run. Copy
`infra/stack/example.tfvars` to `terraform.tfvars` and fill in the required values when an
apply is authorised — the mailbox, the GitHub repository, and the web push keypair
(`pnpm push:keys` prints it); the comments in that file describe every knob, including the cost
ceiling and the two ways to verify an SES sending identity.

## Further reading

| Document | What it holds |
|---|---|
| [docs/runbook.md](docs/runbook.md) | Operating detail: every script, every environment variable, reset, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | System context, AWS runtime, request paths, cost |
| [docs/data-model.md](docs/data-model.md) | The entity model, and where it differs from the original design |
| [docs/adr/](docs/adr/) | Decision records |
| [docs/plan/02-architecture.md](docs/plan/02-architecture.md) | Target architecture: layering, data, notifications, authentication |
| [docs/plan/07-api-route-map.md](docs/plan/07-api-route-map.md) | Every API route, its contract, and who may call it |
