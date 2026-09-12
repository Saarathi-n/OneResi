'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Money,
  Skeleton,
} from '@oneresi/ui';
import { paise } from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The desk's overview: the society at one glance (UC-26). Five figures — collections against
 * dues, the complaint queue by state, gate traffic, facility usage — each with the previous
 * period beside it so the trend is visible without a chart. Zero values when a month is empty:
 * a dashboard explains an empty month, it never errors over one.
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
  // The trend line under a figure: where the number moved, in words. Same period reads as
  // "level" — a flat trend is information, not a failure.
  if (before === now) return <span className="type-micro text-content-subtle">level with the period before</span>;
  const up = now > before;
  const delta = Math.abs(now - before);
  return (
    <span className={`type-micro ${up ? 'text-positive' : 'text-critical'}`}>
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="block" height={130} />
          ))}
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
  const collectionRate =
    f.collectionsPaise + f.duesPaise === 0
      ? null
      : Math.round((f.collectionsPaise / (f.collectionsPaise + f.duesPaise)) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Overview</h1>
        <p className="type-body mt-1 text-content-muted">
          The society at a glance for {f.period} — money, complaints, the gate, the amenities.
        </p>
      </div>

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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card elevation={1}>
          <CardHeader title="Collected this period" />
          <CardBody>
            <Money value={paise(f.collectionsPaise)} size="title" label="collections" />
            <div className="mt-1 flex items-center gap-2">
              {collectionRate !== null ? (
                <Badge tone={collectionRate >= 80 ? 'positive' : 'caution'} size="sm">
                  {collectionRate}% of raised
                </Badge>
              ) : null}
            </div>
            <div className="mt-2">
              <Trend now={f.collectionsPaise} before={f.previousCollectionsPaise} />
            </div>
          </CardBody>
        </Card>

        <Card elevation={1}>
          <CardHeader title="Still owed" />
          <CardBody>
            <Money value={paise(f.duesPaise)} size="title" label="outstanding dues" />
            <p className="type-micro mt-2 text-content-subtle">
              unsettled invoices for {f.period}
            </p>
          </CardBody>
        </Card>

        <Card elevation={1}>
          <CardHeader title="Complaints" />
          <CardBody className="space-y-1">
            <p className="type-title text-content">
              {f.openComplaints} open · {f.inProgressComplaints} in progress
            </p>
            <p className="type-micro text-content-subtle">
              {f.resolvedComplaints} resolved or closed all-time
            </p>
            <Link href="/desk/complaints" className="type-micro text-accent underline-offset-2 hover:underline">
              Work the queue →
            </Link>
          </CardBody>
        </Card>

        <Card elevation={1}>
          <CardHeader title="Gate traffic" />
          <CardBody>
            <p className="type-title text-content">{f.visitorsToday} today</p>
            <div className="mt-2">
              <Trend now={f.visitorsToday} before={f.visitorsYesterday} suffix=" more/less than yesterday" />
            </div>
            <p className="type-micro mt-2 text-content-subtle">
              {f.bookingsThisMonth} amenity bookings this month
              {f.bookingsLastMonth > 0 ? ` (${f.bookingsThisMonth >= f.bookingsLastMonth ? '▲' : '▼'} ${Math.abs(f.bookingsThisMonth - f.bookingsLastMonth)})` : ''}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
