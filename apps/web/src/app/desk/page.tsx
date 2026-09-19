'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  Money,
  ProgressRing,
  Skeleton,
  buttonClass,
} from '@grihaone/ui';
import { formatMoney, formatPeriod, paise } from '@grihaone/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The desk's overview, built as a bento: one figure owns the screen — collected this period, in
 * the money metal, counting itself up — and everything else tiles around it at a lower voice.
 * The pulse strip along the bottom is the committee's answer to "is anything on fire": the gate,
 * the queue, the amenities, one line, no chart.
 */

interface Figures {
  period: string;
  collectionsPaise: number;
  duesPaise: number;
  previousCollectionsPaise: number;
  openComplaints: number;
  inProgressComplaints: number;
  resolvedComplaints: number;
  visitorsToday: number;
  visitorsYesterday: number;
  bookingsThisMonth: number;
  bookingsLastMonth: number;
}

interface ApplicationLine {
  userId: number;
  name: string;
  appliedAt: string;
}

function Trend({ now, before, suffix = '' }: { now: number; before: number; suffix?: string }) {
  // The trend line under a figure: where the number moved, in words, on a soft pill. Same
  // period reads as "level" — a flat trend is information, not a failure. Money trends speak
  // money; counts speak counts (they carry their own suffix).
  if (before === now)
    return (
      <span className="type-micro rounded-pill bg-surface-sunken px-2.5 py-1 text-content-subtle">
        level with the period before
      </span>
    );
  const up = now > before;
  const delta =
    suffix === '' ? formatMoney(paise(Math.abs(now - before))) : String(Math.abs(now - before));
  return (
    <span
      className={`type-micro rounded-pill px-2.5 py-1 ${
        up ? 'bg-positive-soft text-positive' : 'bg-surface-sunken text-critical'
      }`}
    >
      {up ? '▲' : '▼'} {delta}
      {suffix === '' ? ' vs last period' : suffix}
    </span>
  );
}

export default function OverviewPage() {
  const figures = useFetch<Figures>('/api/dashboard');
  const [waiting, setWaiting] = useState<readonly ApplicationLine[] | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await call<readonly ApplicationLine[]>('/api/applications');
      if (result.ok) setWaiting(result.data);
    })();
  }, []);

  if (figures.state.state === 'loading') {
    return (
      <div className="space-y-6">
        <Skeleton variant="text" width={220} height={32} />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton variant="block" height={240} className="lg:col-span-2" />
          <Skeleton variant="block" height={240} />
          <Skeleton variant="block" height={150} />
          <Skeleton variant="block" height={150} />
          <Skeleton variant="block" height={150} />
        </div>
      </div>
    );
  }

  if (figures.state.state === 'failed') {
    return (
      <Card elevation={1}>
        <CardBody>
          <ErrorState title="The overview did not load" onRetry={figures.reload} />
        </CardBody>
      </Card>
    );
  }

  const f = figures.state.data;
  const raised = f.collectionsPaise + f.duesPaise;
  const collectionRate = raised === 0 ? null : Math.round((f.collectionsPaise / raised) * 100);
  const settledSociety = f.duesPaise === 0 && f.collectionsPaise > 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">
          Committee desk · {formatPeriod(f.period)}
        </p>
        <h1 className="type-display mt-1 text-content">The month so far.</h1>
      </header>

      {waiting !== null && waiting.length > 0 ? (
        <Card elevation={0} className="border border-accent bg-accent-soft">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="type-label text-content">
                {waiting.length} application{waiting.length === 1 ? '' : 's'} waiting on the committee
              </p>
              <p className="type-micro text-content-muted">
                {waiting.map((application) => application.name).join(', ')}
              </p>
            </div>
            <Link href="/desk/applications">
              <Button size="sm">Review</Button>
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* The figure the screen is about. */}
        <section
          className={`hero-wash edge-light clip-ticket shadow-e2 rounded-2xl p-6 lg:col-span-2 ${
            settledSociety ? 'bg-accent-soft' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">
                Collected this period
              </p>
              <div className="mt-2">
                <Money
                  value={paise(f.collectionsPaise)}
                  size="mega"
                  countUp
                  tone="gold"
                  glow
                  label="collected this period"
                />
              </div>
              <div className="mt-3">
                <Trend now={f.collectionsPaise} before={f.previousCollectionsPaise} />
              </div>
            </div>
            {collectionRate !== null ? (
              <ProgressRing
                value={collectionRate}
                size={84}
                thickness={7}
                label="share of this period's dues gathered"
                tone={collectionRate >= 80 ? 'positive' : 'caution'}
              >
                <span className="type-label">{collectionRate}%</span>
              </ProgressRing>
            ) : null}
          </div>
          <p className="type-label mt-4 text-content-muted">
            {settledSociety
              ? 'Every invoice settled. The whole society, paid in full.'
              : raised === 0
                ? `Nothing raised for ${formatPeriod(f.period)} yet.`
                : `${formatPeriod(f.period)} is ${collectionRate ?? 0}% gathered.`}
          </p>
        </section>

        {/* The remainder, at a lower voice. */}
        <Card elevation={1} className="flex flex-col justify-between">
          <CardBody>
            <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">Still owed</p>
            <div className="mt-2">
              <Money value={paise(f.duesPaise)} size="title" label="outstanding dues" />
            </div>
            <p className="type-micro mt-2 text-content-subtle">
              unsettled for {formatPeriod(f.period)}
            </p>
            <Link
              href="/desk/ledger"
              className={`${buttonClass('ghost', 'sm')} mt-3 -ml-3`}
            >
              Open the ledger →
            </Link>
          </CardBody>
        </Card>

        <Card elevation={1}>
          <CardBody>
            <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">Complaints</p>
            <p className="type-title mt-2 text-content">
              {f.openComplaints} open · {f.inProgressComplaints} in progress
            </p>
            <p className="type-micro mt-2 text-content-subtle">
              {f.resolvedComplaints} resolved or closed all-time
            </p>
            <Link
              href="/desk/complaints"
              className={`${buttonClass('ghost', 'sm')} mt-3 -ml-3`}
            >
              Work the queue →
            </Link>
          </CardBody>
        </Card>

        <Card elevation={1}>
          <CardBody>
            <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">The gate</p>
            <p className="type-title mt-2 text-content">{f.visitorsToday} through today</p>
            <div className="mt-2">
              <Trend now={f.visitorsToday} before={f.visitorsYesterday} suffix=" vs yesterday" />
            </div>
          </CardBody>
        </Card>

        <Card elevation={1}>
          <CardBody>
            <p className="type-micro uppercase tracking-[0.22em] text-content-subtle">Amenities</p>
            <p className="type-title mt-2 text-content">
              {f.bookingsThisMonth} booking{f.bookingsThisMonth === 1 ? '' : 's'}
            </p>
            <div className="mt-2">
              <Trend now={f.bookingsThisMonth} before={f.bookingsLastMonth} suffix=" vs last month" />
            </div>
            <Link
              href="/desk/bookings"
              className={`${buttonClass('ghost', 'sm')} mt-3 -ml-3`}
            >
              Decisions waiting →
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* The pulse: the society, alive, on one line. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-pill border border-border bg-surface-raised px-5 py-2.5 edge-light">
        <span className="flex items-center gap-2" aria-hidden>
          <span className="inline-block size-2 rounded-pill bg-positive motion-safe:animate-pulse" />
        </span>
        <p className="type-label text-content-muted">
          {f.visitorsToday} through the gate today
          <span aria-hidden className="px-2 text-border-strong">·</span>
          {f.openComplaints + f.inProgressComplaints} complaints being worked
          <span aria-hidden className="px-2 text-border-strong">·</span>
          {f.bookingsThisMonth} booking{f.bookingsThisMonth === 1 ? '' : 's'} this month
        </p>
      </div>
    </div>
  );
}
