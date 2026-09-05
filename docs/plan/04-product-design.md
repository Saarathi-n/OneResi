# 04 — Product Design

Three requirements from you drive this document: it must not read as generated or as a mock,
screen changes must have weight, and the flows need progress and pre-filling. Plus the brand mark
and a real receipt.

## The copy rule, enforced by the build

No coursework framing on any surface a user can see. No use-case identifiers, no ADR numbers, no
subject codes, no register numbers, no "seeded", "demo", "simulated", "mock", "coursework". That
material belongs in `docs/` and in the report.

This is currently violated ~75 times across three pages and six email subjects (D-51 to D-54), so
discipline alone will not hold it. `pnpm check:copy` fails the build on:

```
UC-\d{2}   ADR[- ]?\d{4}   BCSE\d+   24BCE\d+
Seeded   Demo Credentials   Coursework   Simulat(ed|ion)   Mock
```

scanned across `apps/**/src/**` and `packages/mail/templates/**`. Wired into the pre-commit hook
and the pull-request workflow. Exceptions need an inline allow comment with a reason, which makes
each one a visible decision.

A second gate, `pnpm check:enums`, fails if a raw enumeration value reaches a JSX text node. Every
enumeration gets a label map beside it, so `NOT_REQUIRED` renders as "No approval needed" and
`FLAT_2BHK` as "2 BHK" (D-55).

## Brand

**The mark.** A house silhouette whose roofline doubles as the numeral 1, drawn as paths, on a
single-colour ground. Not letters in a rounded square, and not SVG `<text>` — the current favicon
renders differently on every machine because it depends on a system font (D-63).

Delivered once, consumed everywhere:

```
packages/ui/brand/
  mark.svg              24px-optimised, single path, currentColor
  wordmark.svg          mark + "OneResi"
  Logo.tsx              the only place the mark appears in code
  icons/                192, 512, 1024, maskable 512, apple-touch 180, favicon.ico
```

**Palette.** One semantic layer, no raw Tailwind colours in application code. The `brand` scale
already declared in `tailwind.config.ts` and used by nothing (D-59) becomes the source.

| Token | Role |
|---|---|
| `surface` / `surface-raised` / `surface-sunken` | backgrounds |
| `content` / `content-muted` / `content-subtle` | text |
| `accent` | the one brand action colour |
| `positive` `caution` `critical` `info` | status only, never decoration |
| `border` / `border-strong` | edges |

Every token has a dark value from day one, since `darkMode: 'class'` is already configured and
currently does nothing.

**Type.** One self-hosted variable font through `next/font`, so it is identical on every platform
instead of falling back to whatever the OS provides. Scale:

| Step | Mobile | Desktop | Use |
|---|---|---|---|
| `display` | 28 | 34 | one per screen |
| `title` | 20 | 22 | section headings |
| `body` | 15 | 16 | everything |
| `label` | 13 | 13 | field labels, table headers |
| `micro` | 11 | 11 | timestamps only |

The current app sets almost everything at 11–12px (D-60). `body` is the default; `micro` needs a
justification.

## The design system

Three components exist for 7,400 lines of application code, so every input and button is a
re-declared class string, which is why nothing matches anything (D-57). Built once, in
`packages/ui`:

`Button` · `IconButton` · `Field` (label + control + hint + error + `aria-describedby` wired) ·
`Input` · `NumericInput` · `OtpInput` · `Select` · `Combobox` · `DatePicker` · `TimeRange` ·
`Textarea` · `Checkbox` · `Switch` · `RadioCards` · `Card` · `Sheet` · `Dialog` · `Popover` ·
`Tabs` · `Table` · `DataList` · `Badge` · `StatusPill` · `PriorityPill` · `Avatar` · `Toast` ·
`Skeleton` · `EmptyState` · `ErrorState` · `Stepper` · `ProgressRing` · `Money` · `RelativeTime` ·
`CodeDisplay` · `QrCode`

Non-negotiable per component: keyboard reachable, focus visible, labelled for screen readers, a
disabled state, a pending state, and reduced-motion behaviour. `Dialog` and `Sheet` get a real
focus trap and focus restore, which `Modal` has none of today (D-70).

Feedback is `Toast` with undo where the action is reversible. No `alert()`, no `confirm()` (D-56).

## Motion, and what weight means

Weight is not duration. A heavy object accelerates slowly, overshoots slightly, settles, and casts
a shadow that changes as it moves. That is four things, and the current app does none of them —
there is no animation at all, and the only animation classes present belong to a plugin that was
never installed (D-58, D-61).

### Tokens

```ts
duration = { instant: 90, quick: 140, base: 220, slow: 320, deliberate: 480 }

spring = {
  light:  { mass: 0.6, stiffness: 420, damping: 32 },   // toggles, chips
  medium: { mass: 1.0, stiffness: 300, damping: 30 },   // cards, rows, tabs
  heavy:  { mass: 1.6, stiffness: 220, damping: 26 },   // sheets, screens
}

travel = { nudge: 4, near: 8, mid: 16, far: 32 }
```

Springs, not eased durations, for anything that moves in space. `mass` is the weight, `damping`
below ~28 gives the overshoot that reads as momentum.

### Choreography

| Interaction | Motion |
|---|---|
| Forward navigation | outgoing screen scales to 0.98 and fades to 0; incoming enters from `mid` right, `heavy` spring, elevation 0 → 2 during transit |
| Back navigation | exact inverse, and it is inverse — a back gesture that animates forward is the tell that there is no model |
| Bottom sheet | `heavy` spring from below, backdrop `base`, drag-to-dismiss with velocity handoff so a flick continues |
| Dialog | scale 0.96 → 1 with `medium`, `quick` backdrop |
| List entry | stagger 24 ms per row, `near` travel, capped at 8 rows then the rest appear together |
| Tab change | shared-layout underline via `LayoutGroup`; panel cross-fades at `quick` |
| Row mutation | height animates, background flashes the status tone once at `slow` |
| Money change | digit ticker over `slow`, never an instant swap |
| Pass code reveal | characters in at 40 ms stagger, then the card settles |
| Optimistic pending | row at 60% opacity with a shimmer; on failure it springs back with a 6px shake and a toast |
| Pull to refresh | rubber-band with resistance, spinner scales with pull distance |
| Gate verdict | full-bleed tone wash at `quick`, then the card lands `heavy`. Admit and refuse feel physically different — refuse is shorter and harder |

Implementation: `framer-motion` for the component layer, the View Transitions API for
document-to-document navigation on the website where supported, `will-change` only during a
transition. Anything animating on a scroll thread uses transform and opacity only.

### Reduced motion

`prefers-reduced-motion: reduce` replaces travel and scale with opacity at `quick`, keeps every
state change legible, and never removes a transition entirely — an instant swap with no
acknowledgement is worse for vestibular sensitivity than a fast fade. One hook, `useMotion()`,
reads the preference so no component decides for itself.

## Progress

Registration is one long column today with no indication of where you are or how much is left
(D-71). It becomes four steps with a real `Stepper`:

1. **Your home** — block, then unit. Dependent selects; the unit list loads for the chosen block
   only. If the unit is not listed, a free-text claim that an administrator resolves at approval,
   because an applicant must not be able to create units or set their own charge (D-04).
2. **About you** — name, phone with an Indian mask, email with an async availability check that
   resolves while you type rather than on submit.
3. **Password** — a strength meter that measures, plus confirmation. Server policy and client
   policy come from the same Zod schema, so they cannot disagree.
4. **Review** — everything shown back, each line editable in place, then submit.

Around it:

- Progress is a segmented bar with the current step named, not a percentage.
- The draft persists to `localStorage` on every change and is restored with a "picking up where you
  left off" note. Closing the tab does not cost you the form.
- Per-field validation on blur, never on keystroke, with the error tied to the field via
  `aria-describedby`. One summary at the top only after a failed submit, and focus moves to the
  first bad field.
- The submitted state shows what happens next and roughly when — "the committee reviews
  applications daily; you will get an email either way" — rather than an internal status name.

Progress also appears where work has stages: complaint tickets get a four-node timeline with the
current node emphasised and a resolution estimate; the billing run shows units processed against
units total; uploads show real byte progress.

## Pre-filling

Nothing in the application pre-fills anything today. Each of these is a stored preference or a
recent-value lookup, not a guess:

| Surface | Pre-filled from |
|---|---|
| Visitor pass | last three visitor names as chips; the purpose you used most; date defaults to today with tomorrow one tap away |
| Frequent visitors | anyone admitted three or more times becomes a saved contact; one tap issues a pass |
| Complaint | category inferred from the last unresolved one in the same category, only as a preselection you can change; photos from the camera roll |
| Facility booking | last facility, last slot, next available date; slots already taken are disabled with the reason, not merely rejected on submit |
| Payment | amount and period fixed from the invoice; method defaults to the last one used |
| Gate walk-in | unit defaults to the last unit the guard entered; purpose from a short list of what actually happens at a gate — delivery, cab, staff, guest, service |
| Admin notice | category and audience from the previous notice; templates for the recurring ones (water, lift, AGM) |
| Everything | correct `autoComplete` tokens throughout, so password managers and platform autofill work at all (D-73) |

`inputMode="numeric"` and a segmented `OtpInput` on the gate code field — the most-used input in
the product, on a tablet, currently without a numeric keypad.

## Engagement

Not badges and streaks. A residents' association app earns attention by being the fastest way to
do a chore.

- **Home is the next action.** Whatever is most urgent — a visitor at the gate, dues due in three
  days, a complaint awaiting your confirmation — is the top card with the action on it. Not a grid
  of six equal feature tiles.
- **Setup checklist** on first login, with a `ProgressRing`: confirm your phone, add household
  members, save a frequent visitor, set notification preferences. Dismissible, and it disappears
  for good once complete.
- **Household completeness** as a quiet percentage on the profile, which is what actually drives
  people to fill in the optional fields.
- **A real notification centre** backed by the notification rows the outbox produces, with unread
  counts, grouped by day. Live surfaces update over server-sent events and Web Push, so a waiting
  visitor appears without a reload — which is the specific failure you described (D-68).
- **Dues health** — a small paid-months strip for the year. Legible in one glance, and it makes an
  unpaid month obvious without a red banner.
- **Gate log as a feed** on the resident's home: who came, when, who let them in. This is the
  thing residents in real societies actually open the app for.

## The receipt

Its own route, server-rendered from the persisted payment row, addressed by receipt number so the
URL survives a database switch. Print stylesheet, A5, society header, unit, period, amount in
figures and words, method, receipt number, timestamp, and a verification line. Download as PDF.

Today the button calls `window.print()` with no print stylesheet, so it prints the dashboard with
the modal on top of it (D-69), and if the payment row is missing the receipt is invented in the
browser (D-26). Neither survives.

## The two shells

**Website** (`apps/web`) — a real landing page: what the system does, for whom, with actual
screenshots. Not six icon-and-paragraph cards under a gradient headline, and not a demo credential
switcher, which is what is there now (D-01, D-53). Then sign-in, registration, and the committee
desk, which is a dense desktop application: tables with sorting, filtering, column choice, bulk
selection, keyboard navigation, and a command palette.

**App** (`apps/app`) — installable, phone-shaped. Bottom tab bar, safe-area insets, sheets instead
of dialogs, swipe actions on rows, pull to refresh, one-handed reach for primary actions. Offline:
the app shell, your unit's data and your active passes are cached and readable with no network; a
mutation attempted offline is queued and replayed, with the queued state visible on the row. Web
Push for gate approvals and dues reminders. Installable means the manifest, the icon set, the
service worker, `themeColor`, viewport and `appleWebApp` metadata — none of which exist today
(D-62).

The gate kiosk is a third mode of the app: large type, high contrast for daylight, numeric keypad,
one job on screen, and a verdict that is unmissable from a metre away.

