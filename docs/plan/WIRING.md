# Wiring index

Who owns which files, what each piece may import, and how the pieces meet. Written before the
work fans out so parallel streams converge instead of colliding.

## File ownership

Exactly one owner per path. Nobody edits outside their column.

| Stream | Owns | May import |
|---|---|---|
| **foundation** (done) | `packages/contracts/**`, `packages/db/**` | — |
| **domain** | `packages/domain/**` | contracts, db |
| **ui** | `packages/ui/**` | contracts only |
| **mail** | `packages/mail/**` | contracts, db |
| **infra** | `infra/**`, `docs/adr/0004*`+ | — |
| **harness** | `test/**`, `scripts/**`, `eslint.config.js`, `.github/**`, root `package.json` scripts | anything, read-only |
| **web** | `apps/web/**` | contracts, db, domain, ui, mail |
| **app** | `apps/app/**` | contracts, db, domain, ui, mail |

Shared files that are *not* owned by a stream and need a request instead of an edit:
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `packages/db/prisma/schema.base.prisma`.

**Nobody runs `pnpm install`.** Declare dependencies in your own `package.json` and stop; one
install happens at integration. Concurrent installs corrupt the lockfile.

## The seam

Everything meets at two places and nowhere else.

**`@grihaone/contracts`** — enumerations with display labels, `Paise`, Zod schemas, limits, state
machines. Already built. This is the only vocabulary shared across streams. If two streams need to
agree on a value, it belongs here, and it is a request rather than an edit.

**`@grihaone/domain` service interfaces** — `packages/domain/src/ports.ts`. Every use case is a
function taking a validated input and an actor, returning a result or a typed domain error. Route
handlers call these; nothing else contains a rule.

```
apps/web ─┐
          ├─→ @grihaone/domain ─→ @grihaone/db ─→ sqlite | postgresql
apps/app ─┘         │
                    └─→ outbox row ─→ @grihaone/mail worker ─→ console | SES
   both ────────────→ @grihaone/ui  (no data access, ever)
```

## Rules that hold across every stream

1. **No coursework framing in anything a user sees.** No `UC-nn`, no `ADR nnnn`, no `BCSE`, no
   register number, no "seeded", "demo", "simulated", "mock". Comments and `docs/` are the place
   for it. A build gate enforces this.
2. **Enumerations render through their label map.** Never a raw value in a JSX text node.
3. **Money is `Paise`.** Integer. `formatMoney` at the edge, nowhere else.
4. **No handler contains a rule.** Authenticate, parse with a contract, call one service, map the
   result.
5. **Deny by default in authorisation.** No `? {...} : {}` fallback arm — that pattern gave the
   gate account the whole society in the previous build.
6. **`passwordHash` never leaves the data layer.**
7. **A failed read is not an empty read.** Loading, empty and failed are three distinct states.
8. **Reduced motion is respected everywhere**, through one hook.
9. **Strict TypeScript.** `noUnusedLocals` and `noUncheckedIndexedAccess` are on and the build
   fails on a violation.
10. **Cite the defect.** When a change closes something from the register, name it in the comment
    or the commit — `(D-14)`. That is how the errata list writes itself later.
