'use client';

import { useState } from 'react';
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

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'passes', label: 'Passes' },
  { id: 'billing', label: 'Billing' },
  { id: 'notices', label: 'Notices' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  return (
    <div className="min-h-dvh bg-surface text-content scroll-smooth">
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
                <a href="/api/auth/demo?role=resident" className={buttonClass('secondary', 'lg')}>
                  Resident tour
                </a>
                <a href="/api/auth/demo?role=committee" className={buttonClass('ghost', 'lg')}>
                  Committee demo
                </a>
              </div>

              <div className="flex items-center gap-6 pt-4 text-content-subtle type-micro">
                <span>✓ Designed for Indian societies</span>
                <span>✓ Rupee digit grouping</span>
                <span>✓ Verified receipts</span>
              </div>
            </div>

            {/* Right: Elevated Framed Capture of the Product with Interactive Tabs */}
            <div className="relative flex justify-center lg:justify-end">
              <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border-strong bg-surface-raised text-content shadow-e4 edge-light transition-transform duration-300 hover:scale-[1.01]">
                {/* Window Chrome */}
                <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-2.5 text-xs text-content-muted">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-critical/80" />
                    <span className="size-2.5 rounded-full bg-caution/80" />
                    <span className="size-2.5 rounded-full bg-positive/80" />
                    <span className="ml-2 text-content-subtle text-[11px] font-mono">
                      oneresi.in/{activeTab === 'dashboard' ? 'home' : `home/${activeTab}`}
                    </span>
                  </div>
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-content-subtle">
                    Live Portal
                  </span>
                </div>

                {/* Dashboard Frame Preview */}
                <div className="grid grid-cols-[88px_1fr] sm:grid-cols-[116px_1fr] min-h-[330px] text-left">
                  {/* Mini Sidebar */}
                  <div className="border-r border-border bg-surface-sunken/60 p-3 space-y-3 text-[11px]">
                    <div className="font-semibold text-content text-xs tracking-tight">OneResi</div>
                    <div className="space-y-1">
                      {TABS.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-accent text-accent-on shadow-xs'
                                : 'text-content-muted hover:bg-surface-raised hover:text-content'
                            }`}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Main Preview Canvas */}
                  <div className="bg-surface text-content p-4 space-y-3">
                    {activeTab === 'dashboard' && (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold text-content">Gulmohar Court</div>
                            <div className="text-[10px] text-content-muted">Flat A-101 · Resident View</div>
                          </div>
                          <a
                            href="/api/auth/demo?role=resident"
                            className="text-[10px] rounded-full bg-accent text-accent-on px-2.5 py-1 font-medium hover:bg-accent-hover transition-colors"
                          >
                            Open live →
                          </a>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded-xl border border-border bg-surface-raised p-2.5 shadow-xs">
                            <div className="text-[9px] text-content-subtle uppercase tracking-wider font-semibold">
                              Resident dues
                            </div>
                            <div className="text-sm font-bold text-gold font-mono pt-0.5">₹4,850 dues</div>
                            <div className="text-[9px] text-positive mt-1 font-medium flex items-center gap-1">
                              <span className="size-1.5 rounded-full bg-positive inline-block" />
                              Paid on time
                            </div>
                          </div>

                          <div className="rounded-xl border border-accent-border bg-accent-soft p-2.5 shadow-xs">
                            <div className="text-[9px] text-accent uppercase tracking-wider font-semibold">
                              Gate pass
                            </div>
                            <div className="text-xs font-bold text-content pt-0.5">Dunzo Delivery</div>
                            <div className="text-[9px] text-accent mt-1 font-mono">Code 492-815</div>
                          </div>
                        </div>

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
                      </>
                    )}

                    {activeTab === 'passes' && (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold text-content">Gate Pass Control</div>
                            <div className="text-[10px] text-content-muted">Security Cabin Touchscreen Entry</div>
                          </div>
                          <span className="stamp text-[9px] text-positive border-positive">ADMITTED</span>
                        </div>

                        <div className="rounded-xl border border-positive-border bg-positive-soft p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between text-[9px]">
                            <span className="font-semibold text-positive uppercase">Active visitor pass</span>
                            <span className="font-mono text-content-subtle">14:22 IST</span>
                          </div>
                          <div className="text-xs font-bold text-content">Dunzo Delivery · Groceries</div>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="type-code text-xs font-mono bg-surface-raised border border-border px-2 py-0.5 rounded font-bold tracking-widest text-content">
                              492 815
                            </span>
                            <span className="text-[9px] text-content-muted">South Gate Cabin Terminal</span>
                          </div>
                        </div>

                        <div className="space-y-1.5 pt-1">
                          <div className="text-[9px] text-content-subtle uppercase tracking-wider font-semibold">
                            Recent Gate Log
                          </div>
                          <div className="rounded-lg border border-border bg-surface-raised p-2 flex items-center justify-between text-[10px]">
                            <div>
                              <span className="font-medium text-content">Swiggy Delivery</span>
                              <span className="text-content-subtle text-[8px] block">Flat A-101 · Gate 1</span>
                            </div>
                            <span className="font-mono text-[9px] text-content-muted">12:40 IST</span>
                          </div>
                        </div>
                      </>
                    )}

                    {activeTab === 'billing' && (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold text-content">Official Society Receipt</div>
                            <div className="text-[10px] text-content-muted">Receipt #NR-2026-09-0042</div>
                          </div>
                          <span className="stamp text-[9px] text-gold border-gold">SETTLED</span>
                        </div>

                        <div className="rounded-xl border border-border bg-surface-raised p-2.5 space-y-2">
                          <div className="flex justify-between items-baseline">
                            <div>
                              <div className="text-[9px] text-content-subtle uppercase">Maintenance Assessment</div>
                              <div className="text-sm font-bold text-gold font-mono pt-0.5">₹4,850.00</div>
                            </div>
                            <div className="text-[9px] text-right text-content-muted max-w-[130px] italic leading-tight">
                              Four Thousand Eight Hundred Fifty Rupees Only
                            </div>
                          </div>
                          <div className="text-[8px] text-content-subtle bg-surface-sunken/60 rounded p-1.5 border border-border">
                            Direct UPI settlement · Bank reference 425910284 · 0% fee
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                          <div className="rounded-lg border border-border bg-surface-raised p-1.5">
                            <div className="text-content-subtle">Maintenance: ₹3,500</div>
                            <div className="text-content-subtle">Sinking fund: ₹750</div>
                          </div>
                          <div className="rounded-lg border border-border bg-surface-raised p-1.5">
                            <div className="text-content-subtle">Water charges: ₹600</div>
                            <div className="text-positive font-medium">Auto reconciliation</div>
                          </div>
                        </div>
                      </>
                    )}

                    {activeTab === 'notices' && (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold text-content">Society Notice Board</div>
                            <div className="text-[10px] text-content-muted">Managing Committee · Pinned to IST</div>
                          </div>
                          <span className="text-[9px] rounded-full bg-accent-soft text-accent border border-accent-border px-2 py-0.5 font-medium">
                            Active
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <div className="rounded-lg border border-border bg-surface-raised p-2 space-y-1">
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="font-bold text-content">Annual General Meeting (AGM)</span>
                              <span className="text-content-subtle font-mono">Sun 10:00 IST</span>
                            </div>
                            <p className="text-[8px] text-content-muted leading-tight">
                              Clubhouse Main Hall. Audited statements & solar rooftop commissioning agenda.
                            </p>
                          </div>

                          <div className="rounded-lg border border-border bg-surface-raised p-2 space-y-1">
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="font-bold text-content">Overhead Tank Cleaning</span>
                              <span className="text-content-subtle font-mono">Thu 14:00 IST</span>
                            </div>
                            <p className="text-[8px] text-content-muted leading-tight">
                              Quarterly desilting. Alternate sump booster supply remains active during cleaning.
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Numbered Ledger Index Bands */}
      <section id="features" className="scroll-mt-20 py-16 lg:py-24 border-b border-border">
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

      {/* Pricing Section */}
      <section id="pricing" className="scroll-mt-20 py-16 lg:py-24 border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 max-w-2xl">
            <p className="type-micro uppercase tracking-[0.2em] text-content-subtle">Transparent society pricing</p>
            <h2 className="type-title text-3xl sm:text-4xl font-bold mt-2 text-content">
              Simple, predictable community pricing
            </h2>
            <p className="type-body text-content-muted mt-3">
              One flat fee for the entire society. No hidden per-transaction taxes, no surprise tiers, and zero commission on your maintenance collections.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.1fr_1.9fr] items-start">
            {/* Price Hero Card */}
            <div className="rounded-2xl border-2 border-accent bg-surface-raised p-8 shadow-e2 space-y-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 rounded-bl-xl bg-accent px-4 py-1 text-xs font-semibold text-accent-on">
                All-Inclusive
              </div>
              <div>
                <p className="type-label text-content-subtle uppercase tracking-wider">Society Subscription</p>
                <div className="flex items-baseline gap-2 mt-3">
                  <span className="type-mega font-bold text-content font-mono">₹15</span>
                  <span className="type-body text-content-muted">/ flat / month</span>
                </div>
                <p className="type-micro text-content-subtle mt-1">Billed annually to the society management fund</p>
              </div>

              <div className="border-t border-border pt-6 space-y-3">
                <div className="flex items-center gap-2 text-sm text-content">
                  <span className="text-positive font-bold">✓</span>
                  <span>Unlimited resident & tenant logins</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-content">
                  <span className="text-positive font-bold">✓</span>
                  <span>Dedicated gate tablet touchscreen terminal</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-content">
                  <span className="text-positive font-bold">✓</span>
                  <span>Complete committee desk & audit export access</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-content">
                  <span className="text-positive font-bold">✓</span>
                  <span>Zero commission cuts on UPI collections</span>
                </div>
              </div>

              <div className="pt-2 space-y-3">
                <Link href="/register" className={buttonClass('primary', 'lg', 'w-full text-center')}>
                  Get started for your society
                </Link>
                <a href="/api/auth/demo?role=committee" className={buttonClass('secondary', 'lg', 'w-full text-center')}>
                  Explore committee desk demo
                </a>
              </div>
            </div>

            {/* Numbered Feature Breakdown */}
            <div className="rounded-2xl border border-border bg-surface-raised shadow-e1 p-6 sm:p-8">
              <h3 className="type-title text-xl font-bold text-content mb-6">
                Everything included in the flat rate
              </h3>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-bold font-mono">01</span>
                    <h4 className="type-label text-base font-semibold text-content">Automated receipts</h4>
                  </div>
                  <p className="type-body text-sm text-content-muted pl-10">
                    Official society receipts generated with amount spelled in words, sequential receipt numbers, and authentic RWA rubber stamp.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-bold font-mono">02</span>
                    <h4 className="type-label text-base font-semibold text-content">Unlimited gate passes</h4>
                  </div>
                  <p className="type-body text-sm text-content-muted pl-10">
                    Instant visitor passes with 6-digit segmented mono codes, live gate staff kiosk touchscreen verification, and walk-in approval loop.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-bold font-mono">03</span>
                    <h4 className="type-label text-base font-semibold text-content">Complaint resolution queues</h4>
                  </div>
                  <p className="type-body text-sm text-content-muted pl-10">
                    Categorized maintenance work queues for plumbing, electrical, and civil works with full status trails, photo proof, and reopen windows.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-bold font-mono">04</span>
                    <h4 className="type-label text-base font-semibold text-content">Conflict-free amenity holds</h4>
                  </div>
                  <p className="type-body text-sm text-content-muted pl-10">
                    Clubhouse, tennis court, and banquet facility reservations with atomic slot locking to prevent double bookings across residents.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-bold font-mono">05</span>
                    <h4 className="type-label text-base font-semibold text-content">IST pinned timestamps</h4>
                  </div>
                  <p className="type-body text-sm text-content-muted pl-10">
                    Every pass expiry, invoice due date, and ledger entry is permanently anchored to Indian Standard Time regardless of device timezone.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-bold font-mono">06</span>
                    <h4 className="type-label text-base font-semibold text-content">Zero transaction cuts</h4>
                  </div>
                  <p className="type-body text-sm text-content-muted pl-10">
                    Direct bank and UPI settlement straight into your society account. OneResi takes 0% cut from your hard-earned maintenance collections.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About Us Section */}
      <section id="about" className="scroll-mt-20 py-16 lg:py-24 border-b border-border bg-surface-raised/40">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 max-w-2xl">
            <p className="type-micro uppercase tracking-[0.2em] text-content-subtle">Design & Architecture Philosophy</p>
            <h2 className="type-title text-3xl sm:text-4xl font-bold mt-2 text-content">
              Built with real paper physics for Indian housing societies
            </h2>
            <p className="type-body text-content-muted mt-3">
              Most society software treats gated communities as advertising portals or surveillance conduits. OneResi is designed with a fundamentally different philosophy: paper dignity, architectural permanence, and deep respect for community members.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-e1 space-y-4">
              <div className="size-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center font-bold text-lg">
                📄
              </div>
              <h3 className="type-title text-lg font-bold text-content">The Physics of Real Paper</h3>
              <p className="type-body text-sm text-content-muted leading-relaxed">
                Indian society administration runs on physical trust: stamped receipts, tear-off passes, and ledger books. OneResi re-creates these tactile materials digitally — warm ivory paper, edge light along raised sheets, micro-perforations, and authentic double-ringed rubber stamps.
              </p>
              <div className="pt-2">
                <span className="stamp text-[10px] text-accent border-accent">STAMPED RECEIPT</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-e1 space-y-4">
              <div className="size-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center font-bold text-lg">
                🏛️
              </div>
              <h3 className="type-title text-lg font-bold text-content">RWAs & Cooperative Societies</h3>
              <p className="type-body text-sm text-content-muted leading-relaxed">
                Tailored specifically to Maharashtra CHS, Karnataka Apartment Ownership, and Delhi RWA bylaws. Designed for honorary committee treasurers who need transparent accounting, clean unit registers, and definitive dispute trails rather than confusing tech jargon.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-xs text-content-subtle">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1">Lakh & Crore Grouping</span>
                <span className="rounded-full border border-border bg-surface px-2.5 py-1">IST Anchored</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface-raised p-6 shadow-e1 space-y-4">
              <div className="size-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center font-bold text-lg">
                🔒
              </div>
              <h3 className="type-title text-lg font-bold text-content">Zero-Surveillance Integrity</h3>
              <p className="type-body text-sm text-content-muted leading-relaxed">
                No third-party trackers, no banner ads, and no selling resident phone numbers to insurance brokers. Your data is isolated, protected with strict cryptographic tokens, and backed by a resilient transactional outbox architecture with automated reconciliation.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-xs text-content-subtle">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1">Private by Design</span>
                <span className="rounded-full border border-border bg-surface px-2.5 py-1">No Ads</span>
              </div>
            </div>
          </div>

          <div className="mt-12 rounded-2xl border border-border bg-surface-raised p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center sm:text-left">
              <h4 className="type-title text-lg font-bold text-content">Experience the difference live</h4>
              <p className="type-body text-sm text-content-muted">
                Take a self-guided walkthrough as either a resident or a committee administrator right now.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="/api/auth/demo?role=resident" className={buttonClass('primary', 'sm')}>
                Resident tour
              </a>
              <a href="/api/auth/demo?role=committee" className={buttonClass('secondary', 'sm')}>
                Committee demo
              </a>
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
