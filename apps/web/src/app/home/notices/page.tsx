'use client';

import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  RelativeTime,
  Skeleton,
} from '@oneresi/ui';
import {
  ANNOUNCEMENT_CATEGORY,
  type AnnouncementCategory,
} from '@oneresi/contracts';
import { useFetch } from '@/lib/useFetch';

/**
 * Notices: the committee's word to the society, pinned items first, everything else in the order
 * it was published. Category reads through the label map (D-16) and drives the colour, which is
 * the only decoration a notice gets.
 */

interface NoticeLine {
  id: number;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  publishedAt: string;
  authorName: string;
}

export default function NoticesPage() {
  const notices = useFetch<readonly NoticeLine[]>('/api/notices');

  return (
    <div className="space-y-6">
      <h1 className="type-title text-content">Notices</h1>
      <p className="type-body text-content-muted">
        What the committee has published to the society — water shutdowns, meetings, events.
      </p>

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
          title="No notices yet"
          description="When the committee publishes something, every resident sees it here."
        />
      ) : (
        <ul className="space-y-3">
          {notices.state.data.map((notice) => (
            <Card
              key={notice.id}
              elevation={0}
              className={`border ${
                notice.pinned ? 'border-strong bg-surface-raised' : 'border-border'
              }`}
            >
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ANNOUNCEMENT_CATEGORY[notice.category].tone} size="sm">
                    {ANNOUNCEMENT_CATEGORY[notice.category].label}
                  </Badge>
                  {notice.pinned ? (
                    <Badge tone="info" size="sm">
                      Pinned
                    </Badge>
                  ) : null}
                  <span className="type-micro text-content-subtle">
                    <RelativeTime value={notice.publishedAt} size="micro" /> · {notice.authorName}
                  </span>
                </div>
                <h2 className="type-title text-content">{notice.title}</h2>
                <p className="type-body whitespace-pre-line text-content-muted">{notice.body}</p>
              </CardBody>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
