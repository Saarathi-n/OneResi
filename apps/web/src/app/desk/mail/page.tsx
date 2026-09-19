'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@grihaone/ui';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * The mail log: every message the system wrote, one line each, with the provider's own verdict —
 * status from the worker, deliveryState from SES's receipts, attempts from the outbox. The
 * resend button is the designed human step for FAILED rows (the runbook's requeue path); it buys
 * every failed row one more attempt, which the next notifier wake drains.
 *
 * Reading this screen answers the question every mail incident actually asks: did the message
 * leave AWS, and what did the provider say happened to it?
 */

interface MailLine {
  id: number;
  toAddress: string;
  subject: string;
  template: string;
  provider: string;
  status: string;
  deliveryState: string | null;
  error: string | null;
  attempts: number | null;
  outboxStatus: string | null;
  createdAt: string;
  sentAt: string | null;
}

function statusTone(status: string): 'positive' | 'caution' | 'critical' | 'neutral' {
  if (status === 'SENT') return 'positive';
  if (status === 'PENDING') return 'caution';
  if (status === 'FAILED' || status === 'ABANDONED') return 'critical';
  return 'neutral';
}

function deliveryTone(state: string | null): 'positive' | 'critical' | 'neutral' {
  if (state === 'DELIVERY') return 'positive';
  if (state === 'BOUNCE' || state === 'COMPLAINT' || state === 'REJECT') return 'critical';
  return 'neutral';
}

export default function MailLogPage() {
  const mail = useFetch<readonly MailLine[]>('/api/mail');
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function requeue(): Promise<void> {
    setPending(true);
    const result = await call<{ requeued: number }>('/api/mail', {
      method: 'POST',
      json: { action: 'requeue' },
    });
    setPending(false);
    if (result.ok) {
      toast.show({
        title:
          result.data.requeued > 0
            ? `${result.data.requeued} message${result.data.requeued === 1 ? '' : 's'} queued for another attempt`
            : 'Nothing to requeue',
        description: 'The next notifier run drains what was requeued.',
        tone: 'positive',
      });
      mail.reload();
    } else {
      toast.show({ title: 'The requeue did not run', description: result.error.message, tone: 'critical' });
    }
  }

  if (mail.state.state === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton variant="text" width={180} height={32} />
        <Skeleton variant="block" height={300} />
      </div>
    );
  }
  if (mail.state.state === 'failed') {
    return (
      <ErrorState
        title="The mail log did not load"
        description={mail.state.error.message}
        onRetry={() => mail.reload()}
      />
    );
  }
  const lines = mail.state.data;
  if (lines.length === 0) {
    return (
      <EmptyState
        title="No mail yet"
        description="Messages appear here the moment the system writes them — notices, invoices, receipts, complaint updates."
      />
    );
  }

  const failed = lines.filter((line) => line.status === 'FAILED').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-display text-content">Mail log</h1>
          <p className="type-body mt-1 text-content-muted">
            Every message the system wrote, newest first, with the provider&apos;s own verdict on each.
          </p>
        </div>
        <Button
          variant={failed > 0 ? 'secondary' : 'ghost'}
          pending={pending}
          pendingLabel="Requeueing"
          disabled={failed === 0}
          onClick={() => void requeue()}
        >
          {failed > 0 ? `Retry ${failed} failed` : 'Nothing failed'}
        </Button>
      </div>

      <Card elevation={1}>
        <CardHeader
          title="Messages"
          subtitle="status is the worker's own record; delivery is what SES reported back."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="type-label px-4 py-3 text-content">To</th>
                  <th className="type-label px-4 py-3 text-content">Subject</th>
                  <th className="type-label px-4 py-3 text-content">Status</th>
                  <th className="type-label px-4 py-3 text-content">Delivery</th>
                  <th className="type-label px-4 py-3 text-content">Tries</th>
                  <th className="type-label px-4 py-3 text-content">When</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="type-body px-4 py-3 text-content">{line.toAddress}</td>
                    <td className="type-body max-w-64 truncate px-4 py-3 text-content-muted">
                      {line.subject}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(line.status)} size="sm">
                        {line.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={deliveryTone(line.deliveryState)} size="sm">
                        {(line.deliveryState ?? '—').toLowerCase()}
                      </Badge>
                    </td>
                    <td className="type-body px-4 py-3 text-content-muted">{line.attempts ?? '—'}</td>
                    <td className="type-body px-4 py-3 text-content-subtle">
                      {new Date(line.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
