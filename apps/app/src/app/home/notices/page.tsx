'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Badge, Card, RelativeTime } from '@grihaone/ui';
import * as C from '@grihaone/contracts';
import { Icon } from '@/components/icons';
import { AsyncView, CardListSkeleton } from '@/components/AsyncView';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { NoticeWire } from '@/lib/types';

/**
 * The notices feed: the society's circulars in one scroll, pinned ones held at the top so the
 * water-tank shutdown is never buried under a festive-season greeting.
 */

export default function NoticesPage(): ReactNode {
  const reduced = useReducedMotion();
  const notices = useAsync(() => simple<readonly NoticeWire[]>('/api/notices'), []);

  const refresh = useCallback(async () => {
    notices.reload();
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
  }, [notices]);

  return (
    <Shell title="Notices" backHref="/home/more" tabs={RESIDENT_TABS} activeTab="/home/more" onRefresh={refresh}>
      <AsyncView
        state={notices.state}
        skeleton={<CardListSkeleton rows={4} />}
        empty={
          <div className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="type-body font-medium">No notices yet</p>
            <p className="mx-auto mt-1 max-w-72 type-label text-content-subtle">
              When the committee publishes a circular — a shutdown, an event, a rule change — it lands
              here.
            </p>
          </div>
        }
        onRetry={notices.reload}
        render={(list) => {
          const pinned = list.filter((notice) => notice.pinned);
          const rest = list.filter((notice) => !notice.pinned);
          return (
            <div className="flex flex-col gap-3">
              {[...pinned, ...rest].map((notice, index) => (
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
                    <p className="mt-1 whitespace-pre-line type-body text-content-muted">{notice.body}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Badge tone={C.ANNOUNCEMENT_CATEGORY[notice.category].tone} size="sm">
                        {C.ANNOUNCEMENT_CATEGORY[notice.category].label}
                      </Badge>
                      <p className="type-label text-content-subtle">
                        {notice.authorName} · <RelativeTime value={notice.publishedAt} size="label" />
                      </p>
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          );
        }}
      />
    </Shell>
  );
}
