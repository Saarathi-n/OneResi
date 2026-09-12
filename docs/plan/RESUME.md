# Resume here

Session paused 2026-09-05. Everything below is on disk and committed.

## One command to get running again

```
cd "C:\Developer\Code\OneResi - Copy"
pnpm install          # picks up ui / mail / domain deps added since the last install
pnpm typecheck        # THIS IS THE FIRST REAL GATE — see "Start here" below
```

The local database already exists at `.data/oneresi.db`, migrated and seeded. To rebuild it from
nothing: `pnpm db:reset && pnpm db:migrate && pnpm db:seed`.

Seeded accounts, password printed by the seed (generated, not hardcoded):
`ashvinksg@gmail.com` · `ashvin.ks2024@vitstudent.ac.in` · `saarathin@gmail.com`

## Start here

Four parallel streams were stopped mid-flight. Their files are on disk but **none of it has been
typechecked, linted or run.** The first job is integration, in this order:

1. `pnpm install` — `packages/ui`, `packages/mail` and `packages/domain` declared dependencies that
   were never installed, because agents were forbidden from running install (concurrent installs
   corrupt the lockfile).
2. `pnpm typecheck` across the workspace. Expect errors. This is where mismatches between streams
   surface, which is the whole reason they coded against `packages/contracts` and
   `packages/domain/src/ports.ts` instead of against each other.
3. `pnpm test` — the harness stream wrote six test files. Unknown whether they pass.
4. `node scripts/check-copy.mjs` — the copy gate. Unknown whether it runs.
5. `cd infra/stack && terraform init -backend=false && terraform validate` — unknown whether it
   validates.

Only after those five is any of the in-flight work real.

## State by stream

| Stream | On disk | Verified |
|---|---|---|
| Plan | 9 documents | yes — read them, they are the spec |
| `packages/contracts` | 5 modules, 20 files | **yes** — schemas generate, digests match |
| `packages/db` | 25 files, 2 migrations, seed | **yes** — migrated + seeded, convergent over 3 runs |
| `packages/domain` | 4 files: `ports.ts`, `errors.ts` | interfaces only, no service implemented |
| `packages/ui` | 41 files, ~25 components, tokens, motion, brand mark | **no** — never compiled |
| `packages/mail` | 33 files, 13 templates, console + SES providers, worker, `expectMail()` | **no** — never compiled |
| `infra/` | bootstrap + 18-file stack + Dockerfile + 2 Lambdas | **no** — never validated, never applied |
| `test/`, `scripts/` | 6 test files, 4 gate/bootstrap scripts | **no** — never run |
| `apps/web`, `apps/app` | nothing | — |

## Where the percentages stood

Verified ~13%. Potentially ~30–36% once the four streams survive integration.
Phase 4 (the two front ends, 25% of the whole and the only part with a screen) has not started.

## Decisions still waiting on you

Not blocking, but each one is an assumption currently baked in.

1. **Is this repo the clean slate?** It has only `docs/` plus what was built. The previous
   implementation is untouched at `C:\Developer\Code\OneResi`. Assumed yes.
2. **ADR 0003** is still marked Proposed. Assumed accepted, with the amendments in defect D-46.
3. **The five open decisions** answered in `docs/plan/02-architecture.md` — role is single-valued,
   first committee account is seeded then staff are invited, six occupants per unit, unit types
   extended with `VILLA`/`PLOT`/`SHOP`. Assumed yes.
4. **Route 53 domain, yes or no.** ~₹1,000/year. Changes SES sender verification from one manual
   click to zero, and gives a real hostname. Everything else is automated either way.

## Two things to fix at integration

- `tsc --build` emits `.js`/`.d.ts`/`.map` beside sources for anything outside a `dist` outDir.
  Cleaned once already. Needs an explicit `outDir` per package, or a gitignore rule.
- `packages/db/src/env.ts` and `packages/db/scripts/target.mjs` are deliberate mirrors. A test was
  specified to assert they agree; confirm it exists and passes.

## Reading order for the plan

`docs/plan/README.md` → `WIRING.md` (ownership + the ten cross-stream rules) → `TASKS.md` (the
checklist) → then whichever of `01`–`06` the work touches.
