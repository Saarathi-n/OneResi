'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  RelativeTime,
  Skeleton,
  Textarea,
  useToast,
} from '@oneresi/ui';
import { ANNOUNCEMENT_CATEGORY, type AnnouncementCategory } from '@oneresi/contracts';
import { call } from '@/lib/session';
import { useFetch } from '@/lib/useFetch';

/**
 * Announcements: the committee's word to every resident. Publishing lands in every household's
 * notice feed (and a notification); withdrawing is immediate and honest — it does not pretend the
 * notice never existed, it takes it off the feed.
 */

interface NoticeLine {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly category: AnnouncementCategory;
  readonly pinned: boolean;
  readonly publishedAt: string;
  readonly authorName: string;
}

const CATEGORIES = Object.keys(ANNOUNCEMENT_CATEGORY).map((value) => ({
  value,
  label: ANNOUNCEMENT_CATEGORY[value as AnnouncementCategory].label,
}));

/** The category published last time — notices usually travel in the same channel. */
const CATEGORY_KEY = 'oneresi.notice.category';

export default function AnnouncementsPage() {
  const notices = useFetch<readonly NoticeLine[]>('/api/notices');
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [pinned, setPinned] = useState(false);
  const [expiresOn, setExpiresOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [withdrawFor, setWithdrawFor] = useState<NoticeLine | null>(null);
  const [withdrawPending, setWithdrawPending] = useState(false);

  // Open on the category used for the last notice — offered, never forced.
  useEffect(() => {
    try {
      const last = window.localStorage.getItem(CATEGORY_KEY);
      if (last !== null && CATEGORIES.some((option) => option.value === last)) {
        setCategory(last);
      }
    } catch {
      // A blocked localStorage just means starting on General.
    }
  }, []);

  async function publish(): Promise<void> {
    if (title.trim().length < 4) {
      setField('title');
      setError('The title needs at least 4 characters.');
      return;
    }
    if (body.trim().length < 10) {
      setField('body');
      setError('Say a little more — the body needs at least 10 characters.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await call<null>('/api/notices', {
      method: 'POST',
      json: {
        title: title.trim(),
        body: body.trim(),
        category,
        pinned,
        ...(expiresOn === '' ? {} : { expiresOn }),
      },
    });
    setPending(false);
    if (result.ok) {
      setTitle('');
      setBody('');
      setPinned(false);
      setExpiresOn('');
      try {
        window.localStorage.setItem(CATEGORY_KEY, category);
      } catch {
        // Remembering is a convenience, never a requirement.
      }
      notices.reload();
      toast.show({
        title: 'Published',
        description: 'Every household sees it in their notice feed.',
        tone: 'positive',
      });
      return;
    }
    setField(result.error.field ?? null);
    setError(result.error.message);
  }

  async function withdraw(): Promise<void> {
    if (withdrawFor === null) return;
    setWithdrawPending(true);
    const result = await call<null>(`/api/notices/${withdrawFor.id}`, { method: 'DELETE' });
    setWithdrawPending(false);
    if (result.ok) {
      setWithdrawFor(null);
      notices.reload();
      toast.show({ title: 'Notice withdrawn', tone: 'neutral' });
      return;
    }
    toast.show({
      title: 'Could not withdraw it',
      description: result.error.message,
      tone: 'critical',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display text-content">Announcements</h1>
        <p className="type-body mt-1 text-content-muted">
          One notice, every household, immediately. Pin what everyone must read.
        </p>
      </div>

      <Card elevation={1}>
        <CardHeader title="Publish a notice" subtitle="It appears in the residents' notice feed at once." />
        <CardBody className="mt-3 space-y-4">
          <Field label="Title" required error={field === 'title' ? error : undefined}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Water supply interrupted on Saturday"
            />
          </Field>
          <Field label="Category" required>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((option) => (
                <Button
                  key={option.value}
                  variant={category === option.value ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setCategory(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Body" required error={field === 'body' ? error : undefined}>
            <Textarea
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What residents need to know, in plain words."
            />
          </Field>
          <div className="flex flex-wrap items-end gap-6">
            <Field label="Expires on" optional hint="Auto-removed from the feed after this date.">
              <Input
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            </Field>
            <Button
              variant={pinned ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setPinned(!pinned)}
            >
              {pinned ? 'Pinned — will sit at the top' : 'Pin it to the top'}
            </Button>
          </div>
          {error !== null && field === null ? (
            <p className="type-body text-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <Button
              pending={pending}
              pendingLabel="Publishing"
              onClick={() => void publish()}
            >
              Publish
            </Button>
          </div>
        </CardBody>
      </Card>

      <h2 className="type-title text-content">Published</h2>

      {notices.state.state === 'loading' ? (
        <div className="space-y-3">
          <Skeleton variant="block" height={110} />
          <Skeleton variant="block" height={110} />
        </div>
      ) : notices.state.state === 'failed' ? (
        <Card elevation={1}>
          <CardBody>
            <ErrorState title="Notices did not load" onRetry={notices.reload} />
          </CardBody>
        </Card>
      ) : notices.state.data.length === 0 ? (
        <EmptyState
          title="Nothing published yet"
          description="The form above is the only step between you and every household's screen."
        />
      ) : (
        <ul className="space-y-3">
          {notices.state.data.map((notice) => (
            <li key={notice.id}>
              <Card
                elevation={0}
                className={`border ${notice.pinned ? 'border-strong bg-surface-raised' : 'border-border'}`}
              >
                <CardHeader
                  title={notice.title}
                  subtitle={
                    <span className="type-micro text-content-subtle">
                      <RelativeTime value={notice.publishedAt} size="micro" /> · {notice.authorName}
                    </span>
                  }
                  actions={
                    <Button size="sm" variant="danger" onClick={() => setWithdrawFor(notice)}>
                      Withdraw
                    </Button>
                  }
                />
                <CardBody className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ANNOUNCEMENT_CATEGORY[notice.category].tone} size="sm">
                      {ANNOUNCEMENT_CATEGORY[notice.category].label}
                    </Badge>
                    {notice.pinned ? (
                      <Badge tone="info" size="sm">
                        Pinned
                      </Badge>
                    ) : null}
                  </div>
                  <p className="type-body whitespace-pre-line text-content-muted">{notice.body}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={withdrawFor !== null}
        onClose={() => setWithdrawFor(null)}
        title="Withdraw this notice"
        description={
          withdrawFor !== null
            ? `“${withdrawFor.title}” comes off every resident's feed immediately.`
            : ''
        }
      >
        <div className="space-y-4">
          <p className="type-body text-content-muted">
            If the information was wrong, the honest move is to publish a correction — withdrawing
            only removes it from the feed.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWithdrawFor(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              pending={withdrawPending}
              pendingLabel="Withdrawing"
              onClick={() => void withdraw()}
            >
              Withdraw
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
