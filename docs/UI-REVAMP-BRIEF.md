# OneResi — UI revamp brief

A self-contained handoff: what the app is, where every surface lives, the rules any change must
keep, and the upgrades to make. Written for an agent (or a person) who has never seen this
repository.

---

## 1. What the app is

OneResi is a residential community management system for gated societies in India: maintenance
billing with numbered receipts, a front gate with visitor passes and a walk-in approval loop,
complaints with a reopen window, amenity bookings, notices, and web push. One API, one database,
three client surfaces:

| Surface | Where | Port | Who |
|---|---|---|---|
| Website + committee desk + gate kiosk | `apps/web` | 3000 | marketing visitors, committee, gate |
| Installable PWA | `apps/app` (basePath `/a`) | 3001 | residents (phone-first), gate |

Roles: `A` = committee, `S` = gate staff, `R` = resident. Money is stored and crossed as integer
paise; the UI formats rupees. Dates cross as ISO; a calendar day renders as that day everywhere
(`formatCalendarDate` in `@oneresi/contracts`).

Seeded sign-ins (password `starling-marble-97-QUAY`, override with `SEED_PASSWORD`):
`ashvinksg@gmail.com` (committee), `ashvin.ks2024@vitstudent.ac.in` (gate),
`saarathin@gmail.com` (resident, A-101). The seed is a whole lived-in society: 46 units, 39
accounts, three billing periods with receipts, a complaint queue with history, bookings, notices,
visitor passes, a gate log.

## 2. Where everything lives

### The design system — `packages/ui/src`

Every visual decision routes through here; both apps import only from `@oneresi/ui`.

- `tokens.css` — 140 CSS variables in light AND dark (`.dark` / `[data-theme='dark']` on the root
  flips them; the dark values already exist). Colors, surfaces, borders, elevation shadows, the
  `type-*` typography scale.
- `components/` — 26 components: `Button` (+ `buttonClass()` for links that look like buttons),
  `Card`, `Dialog`, `Sheet` (the mobile bottom sheet), `Field`/`Input`/`Select`/`Textarea`,
  `Badge`, `Money`, `Table`, `Tabs`, `Toast`, `Stepper`, `OtpInput`, `PriorityPill`,
  `StatusPill`, `RelativeTime`, `Skeleton`, `EmptyState`, `ErrorState`, `ProgressRing`,
  `NumericInput`, `IconButton`, `CodeDisplay`.
- `internal/control.ts` — `CONTROL_BASE`/`CONTROL_SIZE`: the shared surface every text control
  wears, so an input in a table and an input in a sheet cannot drift.
- `internal/overlay.tsx` — portal, scroll lock, focus trap (recently fixed: the trap follows the
  escape callback through a ref, so typing in a dialog field no longer steals focus).
- `motion/` — framer-motion variants and `useMotion()`. Motion has weight here: screen changes
  feel physical. Keep transitions purposeful, never decorative.
- `brand/Logo`.

### The website + desk + kiosk — `apps/web/src/app`

- `page.tsx` — the marketing landing (server component; the reason `buttonClass` lives outside
  the `'use client'` module).
- `sign-in/`, `register/` (4-step resident wizard), `reset-password/`.
- `home/*` — the resident's web screens: overview, invoices (pay dialog remembers the last
  method), visitors, complaints, facilities, notices, notifications. `home/layout.tsx` carries
  the resident shell + nav.
- `desk/*` — the committee desk, dense and keyboard-first (Ctrl-K command palette in
  `desk/layout.tsx`): `page.tsx` is the Overview dashboard, then ledger, complaints, bookings,
  announcements, property, facilities (amenities register), reports (CSV exports), applications
  (registration queue).
- `gate/*` — the kiosk: large touch targets, pass-code verify, entry/exit, walk-in queue, a live
  SSE feed.
- `receipts/[receiptNo]` — an A5 sheet that prints to PDF from the browser.
- `dev/sync`, `dev/cloud` — the two development consoles (database bridge, deployment console).
  Development-only by design; do not restyle them into product surfaces.
- `lib/session.ts` — `call()` (the one fetch wrapper; access token in memory, silent refresh),
  `useFetch`, `useGuardedSession('COMMITTEE')`.

### The PWA — `apps/app/src/app`

Phone-first under basePath `/a`: `sign-in`, `register` (4-step), `home/*` (complaints with photo
upload, facilities, invoices, notices, notifications, more), `gate` kiosk, `profile`. Service
worker at `apps/app/public/sw.js` (offline cache, push, notification click navigation).
`lib/session.tsx` mirrors the web session with the role router; `components/icons.tsx` is the
app's own stroke icon set — **apps do not import `lucide-react` directly** (only `packages/ui`
may); add icon names to `components/icons.tsx` instead.

### The data the UI renders

`packages/domain/src/ports.ts` is the exact wire shape of every view (`ComplaintView`,
`SocietyBookingView`, …). `packages/contracts/src` holds the Zod schemas AND the formatting
helpers: `formatMoney`/`paise`/`rupees`, `formatCalendarDate`, the enum label maps
(`C.INVOICE_STATUS[status].label`). Raw values and paise cross the wire as-is; the label and the
rupees happen in React, never in a handler.

## 3. Hard rules any change must keep

1. **The copy gate.** `pnpm check:copy` fails the build if user-visible strings contain
   coursework framing: `UC-xx`, `ADR-xxxx`, `D-xx`, `BCSE…`, `24BCE…`, `Seeded`, `Demo
   Credentials`, `Coursework`, `Simulated`, `Mock`. Comments and docs are exempt and encouraged.
   The UI must read like a real product, because it is one.
2. **No new dependencies** without a very good reason — and never `pnpm install` while anything
   else runs.
3. **One vitest suite at a time** (`pnpm test`); never two concurrently. No `next build` in
   parallel with anything.
4. **Verify after every change**: `pnpm --filter @oneresi/web typecheck` (and `@oneresi/app`),
   `pnpm lint`, `pnpm check:copy`. Before finishing: `pnpm test`, and the end-to-end walk
   (`pnpm db:reset && pnpm db:seed`, dev server with `APP_ORIGIN=http://localhost:3000`, then
   `node scripts/e2e-local.mjs` — currently 118 checks, all must stay green).
5. **Dev servers**: web `APP_ORIGIN=http://localhost:3000 pnpm --filter @oneresi/web dev`, app
   `pnpm --filter @oneresi/app dev`. Kill by port before restarting.
6. Design tokens are the only place colors/spacing/typography are invented. A hex in a page is a
   bug.
7. Every interactive element needs its state: loading (Skeleton exists), empty (EmptyState
   exists, and it should teach), error (ErrorState exists, with retry). Partial data is normal;
   a screen that only looks right when everything loaded is not done.

## 4. The upgrades, in priority order

### A. A distinct identity per surface

All three surfaces currently share one Card+Badge skeleton, which is the biggest "generated"
tell. Split them deliberately:

- **Desk** — a working tool: denser rows, monospaced tabular numerals for money and receipt
  numbers (`font-variant-numeric: tabular-nums`), heavier table use, tighter vertical rhythm.
  The command palette is the soul of this surface; lean into keyboard-first.
- **PWA** — a phone app: larger touch targets, bottom-sheet flows (`Sheet`), thumb-reachable
  actions, swipe-friendly card stacks on the home feed.
- **Marketing** — a product page: real content structure (see F below), not a centered hero.

### B. Real data texture everywhere

The seed already provides it; the UI should foreground it. ₹ amounts with Indian digit grouping
(`Money` does this — use it, never hand-format), `RelativeTime` ("2 hours ago") on every list
row, receipt numbers where they exist, actual flat labels ("Gulmohar Court · A-101") — the
convention `Block · Label` is everywhere in the domain already.

### C. Micro-interactions with weight

- The Overview dashboard's figures count up on load (a short ease-out, ~600ms; respect
  `prefers-reduced-motion`).
- The notification bell pulses once when the unread count goes 0 → >0 (the badge already
  exists).
- A receipt number lands with a highlight flash on the payments screen after a payment.
- Use the existing `useMotion()` + transitions — extend, don't invent a second motion system.

### D. Asymmetry: kill the "AI look"

Perfect symmetry, same-height cards, sentences that all start the same way. Concretely:

- The Overview's first card (collections) spans 2 columns and dominates; the rest tile.
- Vary body copy rhythm — the runbook's product copy is already hand-authored; keep that voice
  and break the template feel in headings and empty states.
- One bold number per screen. Today every card competes at the same weight.

### E. Pre-fill and memory (engagement rule)

`apps/web/src/app/home/invoices/page.tsx` already remembers the last payment method
(`localStorage` key `oneresi.payment.method`) — extend the pattern:

- Last complaint category pre-selected on the raise form (web + PWA).
- Recent visitor names offered as chips on the pass form (the domain already returns them in the
  household's entry log — `EntryLogView`).
- Last-viewed facility pre-selected on the booking screen.

### F. The marketing page earns its content

`apps/web/page.tsx` is generic-hero shaped. Make it specific: a real feature walk-through with
framed UI captures (the dev server can produce them), a "built for Indian societies" section
(₹, IST, the gate log residents actually open), honest pricing-free product copy. No stock
photo collages.

### G. Complete the dark mode

The tokens exist in both themes; nothing switches them. Add a theme toggle (resident settings /
desk footer), persist to `localStorage`, set `data-theme` before first paint (a tiny inline
script in the root layout to avoid the flash). Audit each surface in dark — the fixed values are
already there for most of it.

### H. First-run guidance

A dismissible, shown-once card on the resident home ("Install the app" for the PWA-capable
browser via `beforeinstallprompt`, with the push-notification benefit stated), and a
shown-once hint on the desk pointing at Ctrl-K. `localStorage` flag, no server state.

## 5. Suggested order of work

1. B (data texture) and E (pre-fill) — smallest diffs, immediate realism.
2. A (surface identities) — the structural change, do desk → PWA → marketing.
3. D (asymmetry) — rides on A.
4. C (micro-interactions) — after the layouts settle.
5. G (dark mode) and H (first-run) — independent, any time.
6. F (marketing) — last; it benefits from captures of the finished surfaces.

Every step ends with the section-3 verification. When it is all green, the walk reads 118/118
and the gates stay clean.
