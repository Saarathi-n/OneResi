# ADR 0004 — One schema, two database targets, one of them live at a time

**Status** Accepted · 2026-09-05

## Context

Every submitted model assumes PostgreSQL through Prisma, and the deployment provisions RDS for it. What
none of them addresses is where the database comes from during development. Running PostgreSQL locally
means installing and administering a server; running it in the cloud means the meter is on whenever
anyone writes code.

The previous build answered this with a second implementation: a hand-written 798-line object standing
in for the Prisma client, selected whenever `USE_MOCK_DB !== 'false'` — which was the default, and which
the AWS task definition never set. So Terraform provisioned an instance, wired its connection string
into the container, and the container wrote to an in-memory store that reset on every task restart
(D-06).

The cost was not the wasted instance. It was that the two implementations had already diverged on
enumeration values, column names, transaction semantics and fixtures (D-15), and the divergent one was
the only one anybody had ever run. D-16 is the proof: the main registration path inserts a unit type
that does not exist in the schema's enumeration, which the store accepts and real PostgreSQL rejects
with a 500. The primary path through the primary flow had never worked against the system's own schema.

The request behind this ADR was to keep working locally at no cost while the real data lives in RDS.

## Decision

**One schema, two engines.** `packages/db/prisma/schema.base.prisma` is the only hand-edited schema. A
generator emits the SQLite and PostgreSQL variants from it, and a test asserts the two differ in nothing
but the provider line. One Prisma client type, one seed, one set of queries.

**`DB_TARGET` chooses exactly one target at boot.** `local` is a SQLite file that needs nothing
installed and no configuration. `cloud` is RDS, and it must be configured explicitly: if
`DATABASE_URL` is absent, or is not PostgreSQL, or does not carry `sslmode=require`, the process refuses
to start rather than quietly serving local data. In production the check is stricter — `DB_TARGET` must
be `cloud`, and the offline adapter is not loadable at all.

**Which one is live is visible**, in the development console and in the committee footer outside
production, because a target you can misidentify is a target you will misidentify.

**Sync is a command, never a behaviour.** `db:diff` reports, `db:push` sends local to the cloud,
`db:pull` brings the cloud down. Each exports the twelve tables in foreign-key order and upserts by
natural key inside one transaction, so a row present on both sides converges instead of duplicating.
Both directions print a row-count table, ask for confirmation, and compare a per-table checksum
afterwards.

Two dialect differences would have made this painful, and both are removed by decisions that are better
anyway: money becomes integer paise, so there is no `Decimal`, and enumerations become validated string
unions with a `CHECK` constraint on both engines. What remains engine-specific is one partial unique
index on live bookings, which is a five-line branch in a single migration.

On AWS the same migrations and the same seed are applied by a one-off ECS task inside the VPC, before
the service scales up — because the alternative is a provisioned database with no tables in it and no
route from a laptop to fix that (D-19).

## Alternative rejected — automatic failover between the two

The obvious reading of "local as a fallback" is a runtime failover: try RDS, drop to SQLite when the
connection fails. It is rejected outright.

Two writable copies with silent failover diverge, and the divergence cannot be merged afterwards. If a
connection drops mid-session, some writes land locally and some in the cloud, and both copies are now
authoritative while neither is correct. It is worse than a general data-merge problem, because the
guarantees this system relies on are per-database: `UQ_INVOICE_UNIT_PERIOD` and the partial booking
index are what make double billing and double booking impossible, and a second writable copy is
precisely what removes them. Afterwards there is no rule that says which of two invoices for the same
unit and the same period is the real one — that is an adjudication, not a migration.

Read-through from RDS with a local write buffer is a legitimate pattern and would satisfy the same wish,
but it needs conflict resolution designed per table before the first line of it is written. That is not
work to start before the register is closed.

## Consequences

- Local development installs nothing, costs nothing, and runs against a real relational engine with
  real transactions and real constraints.
- Every integration test runs twice, against both engines, and `pnpm test:parity` diffs the results.
  That is the standing cost of this decision and also its whole point: the defect class that produced
  D-15, D-16, D-25 and D-27 cannot come back without failing a test.
- Surrogate integer identifiers differ between targets. Nothing outside the database may depend on an id
  value, which is one reason a receipt is addressed by its receipt number.
- `db:pull` overwrites local data and `db:push` overwrites the cloud's. They are deliberately not
  symmetrical with a merge, they confirm before writing, and the checksum comparison after each
  direction is the acceptance test.
- SQLite is not PostgreSQL. The parity suite is the only thing holding the two honest, so a behaviour it
  does not cover is a defect waiting to be found on the cloud target. This belongs in the report's
  limitations beside the single-AZ instance and the SES sandbox.
- One variable now decides where every write goes, so it is worth saying plainly: `DB_TARGET` is set to
  `cloud` in the ECS task definition, in both Lambda environments, and nowhere else.
