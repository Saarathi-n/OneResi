# GrihaOne UI Reference Images

This directory contains production-grade visual reference designs for the GrihaOne UI revamp, designed specifically to accompany [docs/UI-PAGE-PROMPTS.md](../UI-PAGE-PROMPTS.md) and [packages/ui/src/tokens.css](../../packages/ui/src/tokens.css).

Any IAI agent or developer restyling pages should inspect these images as the gold standard for layout density, color harmony, typography hierarchy, and material feel.

---

## Design System Rules & Tokens

All screens strictly follow the GrihaOne design tokens from `packages/ui/src/tokens.css`:

- **Material & Surfaces**:
  - Base canvas: Warm paper (`--surface`: `#f5f2ea`)
  - Raised sheets & cards: Warm ivory paper (`--surface-raised`: `#fffdf7`)
  - Borders: Crisp, delicate dividers (`--border`: `#e0dacb`, `--border-strong`: `#c9c1ac`)
  - Shadows: Subtle, soft layered elevations (`--elevation-1` to `--elevation-3`)
- **Typography & Content**:
  - Ink: Warm dark charcoal (`--content`: `#211d15`, `--content-muted`: `#5a5343`)
  - Font: Clean, legible sans-serif with tabular numerals for figures (`font-variant-numeric: tabular-nums`)
  - Newspaper masthead scale for home/masthead headers
- **Brand Accent & Status**:
  - Primary Action / Brand: Deep forest emerald green (`--accent`: `#1d6853`, `--accent-hover`: `#185342`, `--accent-soft`: `#eaf5f0`)
  - Money / Outstanding Figures: Warm gold metal (`--gold`: `#8a6800`, `--gold-soft`: `#faf3dc`)
  - Positive / Verified: Deep forest green (`--positive`: `#14724b`)
  - Caution / Pending: Amber gold (`--caution`: `#8a5300`)
  - Critical / Overdue: Brick red (`--critical`: `#b3242c`)
- **Shapes & Details**:
  - Card corner radius: 20px–24px (`--radius-xl`, `--radius-2xl`)
  - Buttons / Controls: Full pill shapes (`--radius-pill: 999px`)
  - Receipts / Passes: Monospace identifiers, perforated tear-line borders, double-ringed rubber stamps (`.stamp`)

---

## Screen Catalog & Prompt Mapping

| Filename | Route | Prompt in `UI-PAGE-PROMPTS.md` | Job & Direction |
| :--- | :--- | :--- | :--- |
| [01-marketing-landing.jpg](./01-marketing-landing.jpg) | `/` (`apps/web`) | **Prompt 1**: The marketing landing | **"The society office wall, redesigned."** Asymmetric split hero (55% editorial display type, 45% elevated real product dashboard preview), horizontal numbered ledger bands (01 Billing, 02 Front gate, 03 Complaints, 04 Amenities). |
| [05-resident-overview.jpg](./05-resident-overview.jpg) | `/home` (`apps/web`) | **Prompt 5**: Resident overview | **"The fridge door."** Masthead greeting (`Gulmohar Court ° A-101`), 4-tile action rail with badge counters, bold outstanding dues (`₹4,850`), two-column split: *Needing you* (waiting gate visitor with inline Approve/Decline) and *Notice Board* (pinned society announcements). |
| [06-resident-payments.jpg](./06-resident-payments.jpg) | `/home/invoices` (`apps/web`) | **Prompt 6**: Payments | **"The maintenance book."** Ledger rows with human-readable status sentences **Due in 3 days*, *Paid*, *Overdue*), monospace receipt tags (`#REC-8841`), and payment dialog sheet with UPI/Card selector and instant receipt confirmation. |
| [07-resident-visitors.jpg](./07-resident-visitors.jpg) | `/home/visitors` (`apps/web`) | **Prompt 7**: Visitors | **"The visitor book by the gate."** Top floating urgent walk-in banner with inline action, pass generation form with recent-visitor chips, 6-digit tear-off pass slip card (`582-914`) with Share button, today's expected timeline strip, and household gate log. |
| [12-committee-desk.jpg](./12-committee-desk.jpg) | `/desk` (`apps/web`) | **Prompt 12**: Overview | **"The dashboard a secretary general reads."** Keyboard-first (`Ctrl+K`), dense tabular numerals, dominant collections card with circular progress arc (`₵4,82,500` / `86% collected`), dues outstanding, gate traffic metrics, and top applications-waiting banner. |
| [21-gate-kiosk.jpg](./21-gate-kiosk.jpg) | `/gate` (`apps/web`) | **Prompt 21**: Verify | **"The security cabin at eye height."** Touchscreen guard terminal, giant 6-digit segmented OTP passcode entry with tactile touch numpad, instant full-screen green `ADMIT` status card with visitor details, flat destination, and prominent confirm-entry touch target. |
| [23-physical-receipt.jpg](./23-physical-receipt.jpg) | `/receipts/[receiptNo]` | **Prompt 23**: The receipt | **"The physical till receipt, perfected."** A5 sheet layout, perforated top edge with semi-circular punch notches, formal society wordmark, monospace receipt identifier, detailed dues breakdown, bold `₹3,500` with amount in words, and authentic `PAID` rubber stamp. |
| [24-pwa-mobile-home.jpg](./24-pwa-mobile-home.jpg) | `/a/home` (`apps/app`) | **Prompt 24**: Resident home (PWA) | **"The morning glance."** Mobile PWA viewport respecting the thumb (44px+ targets), translucent header, prominent dues card with inline Pay, compact *Needing you* walk-in approval card, notice preview, and bottom mobile navigation tab bar. |

---

## Instructions for the UI Coding Agent

1. **Inspect reference image first**: Before writing or modifying any UI component or page, you MUST inspect the corresponding visual reference file in `docs/reference-images/`. Match the proportions, spacing, card elevations, badge placements, and typography hierarchy.
2. **Tokens only**: Every color, radius, shadow, and spacing value must come from `packages/ui/src/tokens.css`. Never use raw hex codes or arbitrary utility values.
3. **Copy gate**: Follow standing rule (2) — no mock, seeded, or coursework words. Use real Indian society phrasing (e.g. *Gulmohar Court*, *Flat A-101*, *Borewell maintenance*, *Dunzo*, *Swiggy*, *₹ paise*).
4. **Typography**: Always use `font-variant-numeric: tabular-nums` for numbers, amounts, timestamps, and pass codes.
5. **Motion & Interaction**: Follow the existing `useMotion()` primitives with weighted, physical transitions.
