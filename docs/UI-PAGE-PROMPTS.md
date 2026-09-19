# OneResi — a design prompt for every page

One copy-paste prompt per page, for the UI agent working in this repository. Each prompt is
self-contained: the standing rules, the page's job, its data, and one strong creative direction.
Work them in any order; each ends verified.

---

## Standing rules (baked into every prompt, stated once here)

> You are restyling ONE page of OneResi, a residential society app for Indian gated communities.
> Hard rules: (0) before implementing or modifying any UI, inspect the corresponding visual reference
> in `docs/reference-images/` (cataloged in `docs/reference-images/README.md`) as the gold standard for
> layout, spacing, and hierarchy; (1) every color, radius, shadow and type size comes from
> `packages/ui/src/tokens.css` — a hex literal in a page is a bug; (2) the copy gate (`pnpm check:copy`)
> fails the build if any user-visible string contains UC-xx, D-xx, BCSE, 24BCE, Seeded, Mock, Simulated
> or Coursework — the UI must read like a real product; (3) money is `paise` integers rendered through
> the `Money` component (₹ with Indian digit grouping), dates through `formatCalendarDate`/`formatPeriod`
> from `@oneresi/contracts`, relative times through `RelativeTime`; (4) every interactive state exists:
> loading (`Skeleton`), empty (`EmptyState` that teaches a first action), error (`ErrorState` with
> retry); (5) motion has weight — use the existing `useMotion()` and transition variants, extend
> them, never invent a second motion system, and respect `prefers-reduced-motion`; (6) finish with
> `pnpm --filter @oneresi/web typecheck` (or `@oneresi/app`), `pnpm lint`, `pnpm check:copy` — all
> green, no new dependencies, no `lucide-react` in apps (use `@oneresi/ui` and the app's own
> `components/icons.tsx`).

---

## WEBSITE — apps/web

### 1. The marketing landing — `/` (`apps/web/src/app/page.tsx`)
*Visual reference:* `docs/reference-images/01-marketing-landing.jpg`

**Job:** convince a society committee in 30 seconds that this is a real product their residents
will actually open.

**Design direction — "the society office wall, redesigned."** Not a generic SaaS hero. Open with
an asymmetric split: the left 55% is editorial — one massive headline in the display type ("The
society app residents actually open" — keep or better it), a two-line subhead, two buttons (the
primary pill, the ghost). The right 45% is a **real framed capture of the product**: a tilted,
elevation-shadowed mock of the resident home screen (a real screenshot from the dev server, or a
faithful CSS recreation) — not a stock collage. Below, a feature walk built as a horizontal
ledger: six numbered rows (Billing with receipts, The front gate, Complaints that close,
Amenities, Notices, Works offline), each row a full-width band with a number in display type, a
one-line benefit in product voice, and a small UI fragment illustrating it. Then one honest band:
"Built for Indian societies" — ₹, IST, the gate log, installable on any phone. Footer minimal.
The page is a server component; use `buttonClass()` for link-buttons (D-84's rule). Kill every
symmetric same-height card.

### 2. Sign in — `/sign-in`

**Job:** one door, three roles, zero friction.

**Design direction — "the gatehouse at dawn."** A centered card is fine; make it *feel* like
something. Left half (hidden on mobile): a full-height panel in the accent-deep token with the
wordmark large and one rotating line of real product truth ("Receipts people can verify." /
"The gate log households can read." — pick three, crossfade slowly). Right half: the form, with
the email field pre-focused, generous type, the password field's reveal toggle, errors inline
under fields (never alerts), the submit pill full-width with a real pending state. Below the
card: "New here? Register" and "Forgot password" as quiet text links. On success the button
morphs into a brief progress state before the role router takes over — motion with weight.

### 3. Registration wizard — `/register`

**Job:** a new occupant self-registers in four steps without dropping out.

**Design direction — "the apartment keys handover."** A four-step `Stepper` across the top that
fills like a promise being kept. Each step is one clear question group with a single primary
action; progress persists (the draft already survives refresh — passwords excluded). Step 1
(Your home): the block/unit pickers as large tappable chips, the claim path sliding in with
weight when "not on the list" is chosen. Step 3 (password): a live strength meter as a segmented
bar with plain words ("Getting there", "Strong"). Step 4 (review): every answer shown back as a
labeled definition list, each line editable via a small "change" that jumps to that step. The
final submit is a full-width pill; success is a full-screen moment — the wordmark, "Your
application is with the committee", and what happens next in two lines.

### 4. Password reset — `/reset-password` and `/reset-password/complete`

**Direction:** the same gatehouse panel as sign-in, one question per screen, a calm
timeline on complete (requested → link sent → new password → signed out everywhere). The
confirmation states are the design: "If that address is registered, a link is on its way" in
calm body type, never a warning color.

---

## RESIDENT WEB — apps/web `/home/*`

### 5. Resident overview — `/home`
*Visual reference:* `docs/reference-images/05-resident-overview.jpg`

**Job:** the answer to "anything needing me?" in one glance.

**Direction — "the fridge door."** The household's single surface of truth. Top: a greeting
band with the person's name and home label ("Gulmohar Court · A-101") in the type scale of a
newspaper masthead. Then a horizontal action rail — four large icon-and-label tiles (Pay dues,
Visitor pass, Complaint, Book) with real counts as badges. Below, a two-column feed: left column
"Needing you" (overdue invoice with its amount big, unresolved complaint, waiting walk-in —
each row a warm elevation card with its primary action inline), right column the notice board
(pinned first, with the committee's latest as readable cards, relative times). One bold number
rules the screen: the outstanding dues, if any, in display type with the Money component. If
nothing needs them, the whole "Needing you" column becomes a single beautiful empty state:
"Nothing needs you today" — make that state gorgeous, it is the reward.

### 6. Payments — `/home/invoices`
*Visual reference:* `docs/reference-images/06-resident-payments.jpg`

**Job:** see what's owed, pay it, keep the receipt.

**Direction — "the maintenance book."** Each invoice is a full-width ledger row: the period as
"September 2026" (`formatPeriod`), the amount in title type with `Money`, the status as a
`StatusPill`, and the due date reading as a human sentence ("Due in 3 days" / "Overdue by 4
days" — derive from `formatCalendarDate`). Paid rows settle into quiet gray with the receipt
number as a monospace tag and a Receipt link. The pay dialog: the amount huge, the method
selector as three large radio cards (UPI / Card / Netbanking — cash is the office's), the
remembered method pre-selected with a small "we remembered UPI" note, and on success the dialog
transforms into the receipt confirmation — number, amount in words, a subtle confetti-free
highlight pulse on the receipt number.

### 7. Visitors — `/home/visitors`
*Visual reference:* `docs/reference-images/07-resident-visitors.jpg`

**Job:** issue passes, see today's expected, answer the door question, read the household log.

**Direction — "the visitor book by the gate."** Three movements down the page. First: the pass
form as a card that feels like filling a register — visitor name (with recent-visitor chips
suggested from the entry log), purpose, date; the generated code revealed as a big friendly
six-digit display with a dashed border like a tear-off slip, plus a "Share" that uses the
Web Share API. Second: today's expected visitors as a timeline strip down the day. Third: the
household gate log as an alternating ledger — pass entries with their code chip, walk-ins
with the approver's name, entered/exited times as quiet monospace. A waiting walk-in floats
as a top banner with Approve/Reject immediately in it — the door question answered in one tap.

### 8. Complaints — `/home/complaints`

**Job:** raise it with photos, then watch it get worked.

**Direction — "the fault register."** The raise form opens as a dialog: category as large
pictorial chips (Plumbing, Electrical, Civil, Security, Common area, Other), priority as a
three-step selector with honest labels, description with a live counter, and the photo picker
as a dashed drop-area that grows thumbnails. The list: each complaint a timeline card — status
changes as a vertical trail with the committee's notes as quoted speech bubbles, resolved ones
wearing a quiet checkmark and the reopen affordance visible only inside the 7-day window (say
"Reopen window closed" after — honesty as design). Photo thumbnails strip under the
description.

### 9. Facilities — `/home/facilities`

**Job:** pick an amenity, see the day's slots, book.

**Direction — "the booking sheet."** Facility cards with hours and the hourly rate; selecting
one opens the day view: a vertical timeline of hourly slots (6:00 → 22:00) where held slots
read as solid, occupied-by-me in the accent, past slots as hatched quiet — held slots show
their reason on hover, never as submit-time rejection (D-72's rule visible). The date picker
is a horizontal week strip. Booking summary slides up from the bottom (the web `Dialog`,
styled as a sheet): facility, window, the charge computed and displayed with `Money`, confirm
as the single pill. My bookings live under a "Yours" tab with cancel that asks once.

### 10. Notices — `/home/notices`

**Direction — "the notice board, but readable."** Pinned notices pinned — a literal pin
accent at the card top and a "Pinned" tag. Each notice: category as a small colored tag,
title in title type, the committee author with a `RelativeTime`, body in comfortable measure
(~65ch). Expired ones never appear (the domain handles it). The board has a gentle stagger —
no perfect grid; two widths alternating, pinned spanning full.

### 11. Notifications — `/home/notifications`

**Direction:** a single reverse-chronological list, unread items with an accent left-rail and
bold title, read items quiet; "Mark all read" as a text action. Each row: icon by type (pass /
visitor / complaint), the title, body, relative time. This page is small — make it perfect
rather than big.

---

## COMMITTEE DESK — apps/web `/desk/*`

**Surface identity (applies to every desk prompt):** the desk is a working tool — dense,
keyboard-first, Ctrl-K palette as the soul. Tabular numerals for every figure
(`font-variant-numeric: tabular-nums`), tighter vertical rhythm than anywhere else, tables
over cards where the data is tabular, and one accent color used only for "needs a decision."

### 12. Overview — `/desk`
*Visual reference:* `docs/reference-images/12-committee-desk.jpg`

**Job:** the society's morning briefing.

**Direction — "the dashboard a secretary general reads."** Asymmetric: the collections card
spans two columns and dominates — the collected amount in display type, the collection-rate as
a thin progress arc, the trend as last month vs this month in words. The other figures (dues
outstanding, complaints by state, gate traffic with yesterday comparison, amenity usage) tile
the remaining grid at deliberately smaller weights — one bold number per screen, everything
else serving it. The applications-waiting banner sits above everything when non-empty, with
names and a Review action. Every figure counts up on load (600ms ease-out,
reduced-motion-aware).

### 13. Ledger — `/desk/ledger`

**Direction — "the accountant's book."** A real `Table`: home, period, amount (tabular
numerals, right-aligned `Money`), status pill, receipt number as a monospace link, paid date.
Filter chips by period across the top (All / latest three periods). Row hover reveals quick
actions. The raise-invoices flow is a dialog wizard: period picker → due date → per-unit
charge preview with a computed total → confirm; a duplicate period refuses with the existing
run shown. Offline payment entry as a focused dialog with the amount in words preview.

### 14. Complaints — `/desk/complaints`

**Direction — "the works queue."** Filter tabs by status with counts. Each complaint a
horizontal card: badges (status, priority pill, category), description clamped to two lines
with expand, photo thumbnails, raised time via `RelativeTime`. History drawer slides down
in-place — the full trail with each note attributed and timed. The update dialog: new status
as a stepper of allowed transitions, the note as a textarea with a counter, and a hint line
"the resident reads this the moment you save" — write for them.

### 15. Bookings — `/desk/bookings`

**Direction:** the society calendar — a week grid of bookings per facility (or a grouped list
on narrow screens); each booking shows home, window, charge; pending ones wear the accent and
open Confirm/Reject with a reason field on reject. Confirmed ones quiet.

### 16. Announcements — `/desk/announcements`

**Direction:** the composer first — a large writing surface (title, category, body with a
comfortable measure, pin toggle, expiry date optional) that previews live as the resident
card on the right. Below, the published list with withdraw as a quiet action that asks once.

### 17. Property — `/desk/property`

**Direction — "the register."** Blocks as expandable sections; units as dense rows (label,
type, charge with `Money`, active state), with inline edit on click and deactivate that
confirms with the resident count named. Creating a unit is a two-field inline row, not a
dialog.

### 18. Amenities — `/desk/facilities`

**Direction:** the facilities register — name, hours as a readable range, hourly rate,
Bookable/Retired badge; edit dialog with hours as two selects that must move together; retire
as the quiet action, restore as its mirror. Photos of each amenity are the stretch goal.

### 19. Reports — `/desk/reports`

**Direction:** deliberately spare — one card: report kind as three large radio rows with
one-line descriptions, from/to date inputs, a Download button that shows real pending state.
The empty-range result arrives as a toast that says the file has only its header. This page's
beauty is its brevity.

### 20. Applications — `/desk/applications`

**Direction — "the queue that ends the day at zero."** Each application a horizontal card:
name big, contact details quiet, the claim (if any) in a quote block reading exactly as the
applicant typed. Approve as the primary pill, Decline as danger with a required reason dialog.
Deciding collapses the card with a satisfying settle. The empty state is the goal state:
"No one is waiting — every application has been answered."

---

## GATE KIOSK — apps/web `/gate/*`

**Surface identity:** a security cabin at eye height — enormous touch targets (the `kiosk`
size exists), high contrast, zero hover-dependence, every action reachable with a thumb, and
nothing that times out mid-entry.

### 21. Verify — `/gate`
*Visual reference:* `docs/reference-images/21-gate-kiosk.jpg`

**Direction:** one giant input, the six-digit code entered as a segmented OTP-style field
(the `OtpInput` exists) at kiosk scale; the verdict arrives as a full-screen state — ADMIT in
the positive with visitor name, destination ("Gulmohar Court · A-101"), purpose and host, and
the confirm-entry button huge; REFUSE as calm amber with its reason. Wrong codes shake once,
never punish.

### 22. Entry & walk-ins — `/gate/entry`, `/gate/walk-ins`, `/gate/live`

**Direction:** walk-in intake as a three-field form with unit search-ahead by block/label;
the waiting queue as large cards with a "call this flat" phone affordance; the live feed
(SSE) as a column that prepends each arrival with a slide-and-settle. Override as its own
clearly-labeled path with the reason required — the exception that names itself.

### 23. The receipt — `/receipts/[receiptNo]`
*Visual reference:* `docs/reference-images/23-physical-receipt.jpg`

**Direction — "the physical till receipt, perfected."** A5 sheet, monospace receipt number
and reference, the society wordmark, amount in words under the figure, a subtle perforated
top edge (pure CSS), and a print stylesheet that makes Ctrl+P produce a clean paper receipt
— this page's success is how well it prints.

---

## PWA — apps/app `/a/*`

**Surface identity:** a phone app that respects the thumb. Bottom sheets (`Sheet`) for every
flow, 44px+ targets, one primary action per screen, content that scrolls under a translucent
header, and the bottom tab bar (exists in layout) as home base. The PWA's home screen is the
product's face — it must feel native, not like a shrunken website.

### 24. Resident home — `/a/home`
*Visual reference:* `docs/reference-images/24-pwa-mobile-home.jpg`

**Direction — "the morning glance."** A header with name, home and the notification bell
(pulsing once when unread rises). A dues card at top when overdue — amount big, Pay button
inline. "Needing you" as compact actionable cards (waiting walk-in with inline
approve/reject — the door question answered from a pocket), then the notice feed, then recent
gate entries. Pull-to-refresh feel via motion variants. This screen gets the most polish —
it is the app.

### 25. The PWA feature screens — `/a/home/{invoices,visitors,complaints,facilities,notices,notifications}`

**Direction:** each mirrors its web sibling's content but re-composed for the thumb: forms in
bottom sheets, lists as full-width cards with generous tap areas, the pass code shown as a
full-width tear-off with Share, the complaint photo picker using the native camera input,
payments confirming with the receipt number highlight. The `more` screen is settings-quiet:
profile, push toggle (exists), theme, sign out.

### 26. PWA auth — `/a/sign-in`, `/a/register`, `/a/reset-password`

**Direction:** the same flows as web but one question per screen, keyboards that match the
field (email keyboard, numeric for phone), autofill-friendly, and the four-step register
keeping its draft across kills.

### 27. PWA gate — `/a/gate/*`

**Direction:** the same kiosk language as web — huge OTP entry, full-screen verdicts —
tuned to a phone the guard holds. If a society runs the gate from a phone, this is the gate.

---

*Twenty-seven prompts, one per page. Each ends with the standing verification: typecheck the
package, `pnpm lint`, `pnpm check:copy` — and when a batch is done, the walk
(`node scripts/e2e-local.mjs` on a fresh seed) stays 118/118.*
