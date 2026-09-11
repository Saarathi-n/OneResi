import Link from 'next/link';
import {
  Logo,
  buttonClass,
} from '@oneresi/ui';

/**
 * The public landing page. A real explanation of what the system does and for whom, structured
 * around the three jobs a society actually hires it for — not a grid of icon cards (D-53's
 * lesson, and the design doc's "Website" section).
 */

const worksFor = [
  {
    role: 'Residents',
    lines: [
      'Raise a visitor pass in seconds and answer the gate from anywhere',
      'Pay maintenance by UPI and download the receipt that the society issued',
      'Track a complaint through its life, not into a void',
    ],
  },
  {
    role: 'Committee members',
    lines: [
      'Approve registrations and resolve claimed homes from one queue',
      'Raise a billing period once, with every amount snapshotted at that moment',
      'Decide facility bookings with the conflicts already marked',
    ],
  },
  {
    role: 'Security staff',
    lines: [
      'One screen at the gate: enter a pass code, get a clear verdict',
      'Walk-in visitors logged and sent to the right household instantly',
      'Every entry and exit attributed to a person, not a shift',
    ],
  },
];

const numbers = [
  { value: '4 steps', label: 'from sign-up to an application the committee can act on' },
  { value: '15 min', label: 'access-token lifetime — sessions die with a password change' },
  { value: 'Every rupee', label: 'receipted with a number that survives an archive switch' },
];

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="max-w-2xl">
      <p className="type-label text-content-subtle uppercase tracking-wide">{eyebrow}</p>
      <h2 className="type-title mt-2 text-content">{title}</h2>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface">
      {/* Header */}
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo variant="wordmark" size={32} />
          <nav className="flex items-center gap-3">
            <Link href="/sign-in" className={buttonClass('ghost', 'sm', 'hidden sm:inline-flex')}>
              Sign in
            </Link>
            <Link href="/register" className={buttonClass('primary', 'sm')}>
              Join your society
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div className="flex flex-col justify-center">
            <h1 className="type-display text-balance text-content">
              The society app residents actually open
            </h1>
            <p className="type-body mt-5 max-w-xl text-content-muted">
              OneResi runs maintenance billing, the front gate, complaints and facility bookings
              for residential communities in India — with receipts people can verify, a gate log
              households can read, and a committee desk that does not drown in spreadsheets.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className={buttonClass('primary', 'lg')}>
                Create your account
              </Link>
              <Link href="/sign-in" className={buttonClass('secondary', 'lg')}>
                Sign in
              </Link>
            </div>
            <p className="type-micro mt-4 text-content-subtle">
              The first account activates the society; everyone after joins by application.
            </p>
          </div>

          {/* The gate card — a real artifact of the product, rendered small. */}
          <div className="flex items-center justify-center">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-6 shadow-e2">
              <p className="type-label text-content-subtle uppercase tracking-wide">
                At the gate, right now
              </p>
              <p className="type-body mt-3 text-content">A visitor entered pass 482913</p>
              <div className="mt-4 rounded-xl bg-positive-soft p-4">
                <p className="type-title text-positive">Admit — Ravi Sharma, delivery</p>
                <p className="type-body mt-1 text-content-muted">
                  Host notified at the moment of check-in. The household sees the arrival live,
                  without a reload.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <p className="type-micro text-content-subtle">Gate log · attributed to a guard</p>
                <span className="type-micro text-content-subtle">entry 14:32</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For whom */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <SectionHeading
            eyebrow="Who it is for"
            title="Three jobs, one system — not a portal per person"
          />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {worksFor.map((group) => (
              <div
                key={group.role}
                className="rounded-xl border border-border bg-surface-raised p-6"
              >
                <h3 className="type-title text-content">{group.role}</h3>
                <ul className="mt-4 space-y-3">
                  {group.lines.map((line) => (
                    <li key={line} className="type-body text-content-muted">
                      <span aria-hidden="true" className="mr-2 text-accent">
                        —
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Receipts / money */}
      <section className="border-b border-border bg-surface-sunken">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading
              eyebrow="Money, with proof"
              title="Every payment carries a numbered receipt"
            />
            <p className="type-body mt-4 max-w-lg text-content-muted">
              Amounts are recorded in paise and issued with the amount in words, the society&apos;s
              header, and a verification line. The receipt lives at its own address — print it,
              save it as PDF, or send it to your auditor without opening an app.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-raised p-6">
            <p className="type-label text-content-subtle uppercase tracking-wide">Receipt 2025-07-014</p>
            <p className="type-title mt-2 text-content">Rs. 3,500.00 — Unit B-204, July 2025</p>
            <p className="type-body mt-2 text-content-muted">
              Three thousand five hundred rupees only · paid by UPI · issued 18 July 2025, 09:12
            </p>
            <p className="type-micro mt-4 text-content-subtle">
              Verify against the society office with the receipt number and unit.
            </p>
          </div>
        </div>
      </section>

      {/* Trust numbers */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-8 sm:grid-cols-3">
            {numbers.map((item) => (
              <div key={item.value}>
                <p className="type-title text-accent">{item.value}</p>
                <p className="type-body mt-2 text-content-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="bg-surface-raised">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-6 py-14">
          <h2 className="type-title text-content">Run your society on records, not WhatsApp</h2>
          <p className="type-body max-w-lg text-content-muted">
            Register with your flat number. If your unit is not listed yet, describe it and the
            committee resolves it when they approve you.
          </p>
          <Link href="/register" className={buttonClass('primary', 'lg')}>
            Join your society
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Logo variant="wordmark" size={20} />
          <p className="type-micro text-content-subtle">
            OneResi — community management that residents actually use.
          </p>
        </div>
      </footer>
    </div>
  );
}
