'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  RelativeTime,
  Select,
  Sheet,
  Textarea,
  useToast,
} from '@grihaone/ui';
import * as C from '@grihaone/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import { todayInput } from '@/lib/format';
import type { NoticeWire } from '@/lib/types';

/**
 * The notice board from the writing side. Publishing is one write — the submitted model has no
 * draft state — and it fans the mail out inside that write, so a published notice here is a
 * notice every active resident has been told about. A withdrawal does not delete anything; it
 * pulls the expiry to now, which takes the notice off every feed while the record stays.
 */
export default function AnnouncementsPage(): ReactNode {
  const reduced = useReducedMotion();
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<NoticeWire | null>(null);

  const notices = useAsync(() => simple<readonly NoticeWire[]>('/api/notices'), []);

  const refresh = useCallback(async () => {
    notices.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [notices]);

  async function withdraw(notice: NoticeWire): Promise<boolean> {
    const result = await simple<null>(`/api/notices/${notice.id}`, { method: 'DELETE' });
    if (result.ok) {
      toast.show({
        title: 'Off the board',
        description: `"${notice.title}" no longer appears on any feed.`,
      });
      notices.reload();
      return true;
    }
    if (result.error.code === 'ALREADY_DONE') {
      toast.show({ title: 'It was already off the feed', description: 'Nothing to withdraw.' });
      notices.reload();
      return true;
    }
    toast.show({ title: 'That did not go through', description: result.error.message, tone: 'critical' });
    return false;
  }

  return (
    <Shell
      title="Announcements"
      subtitle="Publish to the whole society"
      backHref="/desk/more"
      tabs={COMMITTEE_TABS}
      activeTab="/desk/more"
      onRefresh={refresh}
      headerRight={
        <Button
          size="sm"
          onClick={() => {
            setPublishing(true);
          }}
        >
          <Icon name="plus" size={16} />
          Publish
        </Button>
      }
    >
      <AsyncView
        state={notices.state}
        skeleton={<CardListSkeleton rows={4} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">The board is empty</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              A shutdown notice, a festivity, a rule change — publish the first one and every active
              resident hears about it.
            </p>
          </div>
        }
        onRetry={notices.reload}
        render={(list) => (
          <div className="flex flex-col gap-3">
            {list.map((notice, index) => (
              <div key={notice.id} className="row-in" style={rowStyle(index, reduced)}>
                <Card tone={notice.pinned ? C.ANNOUNCEMENT_CATEGORY[notice.category].tone : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="type-body font-medium">{notice.title}</p>
                    {notice.pinned ? (
                      <span className="shrink-0 text-content-muted" title="Pinned">
                        <Icon name="megaphone" size={16} />
                        <span className="sr-only">Pinned</span>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line type-body text-content-muted">
                    {notice.body}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Badge tone={C.ANNOUNCEMENT_CATEGORY[notice.category].tone} size="sm">
                      {C.ANNOUNCEMENT_CATEGORY[notice.category].label}
                    </Badge>
                    <p className="type-label text-content-subtle">
                      {notice.authorName} · <RelativeTime value={notice.publishedAt} size="label" />
                    </p>
                  </div>
                  <div className="mt-3 border-t border-border pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setWithdrawing(notice);
                      }}
                    >
                      Withdraw
                    </Button>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
      />

      {publishing ? (
        <PublishSheet
          onClose={() => {
            setPublishing(false);
          }}
          onPublished={() => {
            setPublishing(false);
            notices.reload();
            toast.show({
              title: 'Published',
              description: 'Every active resident has been mailed, and it is on the board.',
            });
          }}
        />
      ) : null}

      {withdrawing !== null ? (
        <WithdrawSheet
          notice={withdrawing}
          onClose={() => {
            setWithdrawing(null);
          }}
          onWithdrawn={async () => {
            const done = await withdraw(withdrawing);
            if (done) setWithdrawing(null);
            return done;
          }}
        />
      ) : null}
    </Shell>
  );
}

function PublishSheet({
  onClose,
  onPublished,
}: {
  readonly onClose: () => void;
  readonly onPublished: () => void;
}): ReactNode {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<C.AnnouncementCategory>('GENERAL');
  const [pinned, setPinned] = useState(false);
  const [expiresOn, setExpiresOn] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(): Promise<void> {
    if (pending) return;
    const found: Record<string, string> = {};
    if (title.trim().length < 4) found.title = 'Give the notice a headline of at least 4 characters.';
    if (body.trim().length < 10) found.body = 'Say what the notice is about — at least 10 characters.';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await simple<NoticeWire>('/api/notices', {
      method: 'POST',
      json: {
        title: title.trim(),
        body: body.trim(),
        category,
        pinned,
        ...(expiresOn !== '' ? { expiresOn } : {}),
      },
    });
    setPending(false);
    if (result.ok) {
      onPublished();
      return;
    }
    if (result.error.field !== undefined) {
      setErrors({ [result.error.field]: result.error.message });
    } else {
      setErrors({ form: result.error.message });
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Publish a notice"
      description="One write, and it is on every resident's board with a mail behind it."
      pending={pending}
      footer={
        <Button
          size="lg"
          fullWidth
          pending={pending}
          pendingLabel="Publishing"
          onClick={() => {
            void submit();
          }}
        >
          Publish to the society
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Headline" required error={errors['title']}>
          <Input
            value={title}
            maxLength={140}
            invalid={errors['title'] !== undefined}
            placeholder="Water tank cleaning on Sunday"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </Field>

        <Field label="The notice" required error={errors['body']}>
          <Textarea
            value={body}
            rows={6}
            maxLength={5000}
            showCount
            invalid={errors['body'] !== undefined}
            placeholder="Supply will be off from 10 am to 1 pm. Please store water accordingly."
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
        </Field>

        <Field label="Category" required>
          <Select
            value={category}
            options={C.ANNOUNCEMENT_CATEGORIES.map((value) => ({
              value,
              label: C.ANNOUNCEMENT_CATEGORY[value].label,
            }))}
            onChange={(event) => {
              setCategory(event.target.value as C.AnnouncementCategory);
            }}
          />
        </Field>

        <Field label="Expires on" optional hint="After this date the notice leaves every feed on its own.">
          <Input
            type="date"
            value={expiresOn}
            min={todayInput()}
            invalid={errors['expiresOn'] !== undefined}
            onChange={(event) => {
              setExpiresOn(event.target.value);
            }}
          />
        </Field>

        <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 focus-ring-inset">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => {
              setPinned(event.target.checked);
            }}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span className="min-w-0">
            <span className="type-body font-medium">Pin to the top</span>
            <span className="block type-label text-content-subtle">
              Pinned notices stay above everything else until they expire or are withdrawn.
            </span>
          </span>
        </label>

        {errors['form'] !== undefined ? (
          <p
            role="alert"
            className="rounded-lg border border-critical-border bg-critical-soft px-4 py-3 type-body text-critical"
          >
            {errors['form']}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function WithdrawSheet({
  notice,
  onClose,
  onWithdrawn,
}: {
  readonly notice: NoticeWire;
  readonly onClose: () => void;
  readonly onWithdrawn: () => Promise<boolean>;
}): ReactNode {
  const [pending, setPending] = useState(false);

  return (
    <Sheet
      open
      onClose={onClose}
      title="Withdraw this notice"
      description="It comes off every feed now. The record and its audit trail stay, so nothing is erased."
      pending={pending}
      footer={
        <Button
          size="lg"
          variant="danger"
          fullWidth
          pending={pending}
          pendingLabel="Withdrawing"
          onClick={() => {
            setPending(true);
            void onWithdrawn().then((done) => {
              if (!done) setPending(false);
            });
          }}
        >
          Take it off the board
        </Button>
      }
    >
      <Card padding="tight">
        <p className="type-body font-medium">{notice.title}</p>
        <p className="mt-1 type-label text-content-subtle">
          {notice.authorName} · <RelativeTime value={notice.publishedAt} size="label" />
        </p>
      </Card>
    </Sheet>
  );
}
