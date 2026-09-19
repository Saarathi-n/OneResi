import Link from 'next/link';
import { Logo, buttonClass } from '@oneresi/ui';

/**
 * The public landing page. Aligned directly to docs/reference-images/01-marketing-landing.jpg
 * and Prompt 1 in docs/UI-PAGE-PROMPTS.md: "The society office wall, redesigned."
 */

const INDEX_BANDS = [
  {
    num: '01',
    title: 'Billing with receipts',
    tags: ['Automated tracking', 'Elevated tracking'],
    desc: 'Every payment carries an official society receipt with amount in words and authentic stamp.',
  },
  {
    num: '02',
    title: 'The front gate',
    tags: ['Visitor management'],
    desc: 'Instant digital visitor passes, tear-off slips with mono codes, and live walk-in door verification.',
  },
  {
    num: '03',
    title: 'Complaints that close',
    tags: ['Track resolutions'],
    desc: 'Work queues for electrical, plumbing and civil repairs with transparent status trails and photos.',
  },
  {
    num: '04',
    title: 'Amenities',
    tags: ['Easy booking'],
    desc: 'Clubhouse, terrace and sports facilities booked with real-time conflict-free slot holds.',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface text-content">
      {/* Header */}
      <header className="border-b border-border bg-surface-raised/80 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="OneResi home" className="flex items-center gap-2">
            <Logo variant="wordmark" size={30} />
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-content-muted">
            <a href="#features" className="hover:text-content transition-colors">
              Features
            </a>
            <a href="#pricing" className="hover:text-content transition-colors">
              Pricing
            </a>
            <a href="#about" className="hover:text-content transition-colors">
              About Us
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/sign-in" className={buttonClass('ghost', 'sm')}>
              Sign in
            </Link>
            <Link href="/register" className={buttonClass('primary', 'sm')}>
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-16 lg:pt-20 lg:pb-24 border-b border-border">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            {/* Left Editorial Copy */}
            <div className="space-y-6">
              <h1 className="type-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-content text-balance">
                The society app residents actually open
              </h1>
              <p className="type-body text-lg text-content-muted max-w-xl leading-relaxed">
                Centralize billing, security, and amenities in one elegant digital hub, built for modern residential life.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link href="/register" className={buttonClass('primary', 'lg')}>
                  Book a walkthrough
                </Link>
                <Link href="/home" className={buttonClass('secondary', 'lg')}>
                  Resident tour
                </Link>
              </div>

              <div className="flex items-center gap-6 pt-4 text-content-subtle type-micro">
                <span>✓ Designed for Indian societies</span>
                <span>✓ Rupee digit grouping</span>
                <span>✓ Verified receipts</span>
              </div>
            </div>

            {/* Right: Elevated Framed Capture of the Product */}
            <div className="relative flex justify-center lg:justify-end">
              <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-strong bg-[#191612] text-white shadow-e4 edge-light transition-transform duration-300 hover:scale-[1.01]">
                {/* Mock Browser/App Chrome */}
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 bg-black/40 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-red-500/80" />
                    <span className="size-2.5 rounded-full bg-amber-500/80" />
                    <span className="size-2.5 rounded-full bg-emerald-500/80" />
                    <span className="ml-2 text-white/50 text-[11px] font-mono">oneresi.in/home</span>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                    Live Portal
                  </span>
                </div>

                {/* Dashboard Frame Preview */}
                <div className="grid grid-cols-[80px_1fr] sm:grid-cols-[110px_1fr] min-h-[300px] text-left">
                  {/* Mini Sidebar */}
                  <div className="border-r border-white/10 bg-[#14120e] p-3 space-y-4 text-[11px]">
                    <div className="font-semibold text-white/90 text-xs tracking-tight">OneResi</div>
                    <div className="space-y-1 text-white/60">
                      <div className="rounded-md bg-emerald-950/80 text-emerald-400 font-medium px-2 py-1">
                        Dashboard
                      </div>
                      <div className="px-2 py-1 hover:text-white">Passes</div>
                      <div className="px-2 py-1 hover:text-white">Billing</div>
                      <div className="px-2 py-1 hover:text-white">Notices</div>
                    </div>
                  </div>

                  {/* Main Preview Canvas */}
                  <div className="bg-[#f5f2ea] text-content p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-content font-serif">Gulmohar Court</div>
                        <div className="text-[10px] text-content-muted">Flat A-101</div>
                      </div>
                      <span className="text-[10px] rounded-full bg-emerald-800 text-white px-2 py-0.5 font-medium">
                        View dashboard
                      </span>
                    </div>

                    {/* Preview Cards Grid */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-xl border border-border bg-surface-raised p-2.5 shadow-xs">
                        <div className="text-[9px] text-content-subtle uppercase tracking-wider">Resident dues</div>
                        <div className="text-sm font-bold text-gold font-mono pt-0.5">₹4,850 dues</div>
                        <div className="text-[9px] text-positive mt-1">Paid on time</div>
                      </div>

                      <div className="rounded-xl border border-emerald-700/30 bg-emerald-800 text-white p-2.5 shadow-xs">
                        <div className="text-[9px] text-white/70 uppercase tracking-wider">Gate pass</div>
                        <div className="text-xs font-bold pt-0.5">Active visitor</div>
                        <div className="text-[9px] text-emerald-200 mt-1">Dunzo Delivery</div>
                      </div>
                    </div>

                    {/* Mini Tiles */}
                    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                      <div className="rounded-lg border border-border bg-surface-raised p-2">
                        <div className="font-semibold text-content text-[10px]">Billing tracking</div>
                        <div className="text-[8px] text-content-subtle">Auto receipts</div>
                      </div>
                      <div className="rounded-lg border border-border bg-surface-raised p-2">
                        <div className="font-semibold text-content text-[10px]">Complaints</div>
                        <div className="text-[8px] text-content-subtle">Quick closure</div>
                      </div>
                      <div className="rounded-lg border border-border bg-surface-raised p-2">
                        <div className="font-semibold text-content text-[10px]">Amenities</div>
                        <div className="text-[8px] text-content-subtle">Slot holds</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Numbered Ledger Index Bands */}
      <section id="features" className="py-16 lg:py-24 border-b border-border">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-8">
            <p className="type-micro uppercase tracking-[0.2em] text-content-subtle">Everything in order</p>
            <h2 className="type-title text-2xl sm:text-3xl font-bold mt-1">Numbered index of core services</h2>
          </div>

          <div className="rounded-2xl border border-border bg-surface-raised shadow-e1 divide-y divide-border overflow-hidden">
            {INDEX_BANDS.map((item) => (
              <div
                key={item.num}
                className="grid grid-cols-1 md:grid-cols-[80px_1.5fr_1.5fr_auto] items-center gap-4 p-5 sm:p-6 transition-colors hover:bg-surface-sunken/40"
              >
                <span className="type-code text-2xl font-bold text-content-subtle font-mono">{item.num}</span>
                <h3 className="type-title text-lg font-semibold text-content">{item.title}</h3>
                <p className="type-body text-sm text-content-muted">{item.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-content-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built for Indian Societies */}
      <section className="py-16 bg-surface-raised/40 border-b border-border">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="space-y-2">
              <p className="type-title text-xl font-bold text-accent">₹ Grouping & UPI-First</p>
              <p className="type-body text-sm text-content-muted">
                Indian currency lakh and crore comma formatting. Direct UPI payment via GPay, PhonePe, and instant verified till receipts.
              </p>
            </div>
            <div className="space-y-2">
              <p className="type-title text-xl font-bold text-accent">IST Pinned Dates</p>
              <p className="type-body text-sm text-content-muted">
                Dates and gate entries stay pinned to Indian Standard Time regardless of reader timezone. A due date never shifts arbitrarily.
              </p>
            </div>
            <div className="space-y-2">
              <p className="type-title text-xl font-bold text-accent">Gate Kiosk Terminal</p>
              <p className="type-body text-sm text-content-muted">
                Security cabin touchscreen entry with 6-digit segmented codes and instant rotated admission rubber stamp verdicts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 px-6 text-sm text-content-muted">
          <div className="flex items-center gap-3">
            <Logo variant="wordmark" size={24} />
            <span className="text-content-subtle">·</span>
            <span>The society app residents actually open</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-content-subtle">
            <span>Gulmohar Court</span>
            <span>Palm Villas</span>
            <span>Built with real paper physics</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
