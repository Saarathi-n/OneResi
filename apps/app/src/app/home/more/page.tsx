'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Card } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { Shell } from '@/components/Shell';
import { simple } from '@/lib/api';
import { RESIDENT_TABS } from '@/lib/tabs';
import { useAsync } from '@/hooks/useAsync';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';
import type { NotificationsWire } from '@/lib/types';

/**
 * The "everything else" shelf. The tab bar carries the daily surfaces; this is where the occasional
 * ones live, with the unread count on notices so a fresh circular is never missed.
 */

const LINKS = [
  {
    href: '/home/facilities',
    icon: 'calendar',
    title: 'Facilities',
    body: 'Club house, courts, guest rooms — check a day and request a slot.',
  },
  {
    href: '/home/notices',
    icon: 'megaphone',
    title: 'Notices',
    body: 'The society circulars, pinned ones first.',
  },
  {
    href: '/home/notifications',
    icon: 'bell',
    title: 'Notifications',
    body: 'What has happened since you last looked.',
  },
  {
    href: '/profile',
    icon: 'user',
    title: 'Your profile',
    body: 'Contact details, password, and signing out.',
  },
] as const;

export default function MorePage(): ReactNode {
  const reduced = useReducedMotion();
  const notifications = useAsync(() => simple<NotificationsWire>('/api/notifications'), []);
  const unread = notifications.state.state === 'ready' ? notifications.state.data.count : 0;

  return (
    <Shell title="More" tabs={RESIDENT_TABS} activeTab="/home/more">
      <div className="flex flex-col gap-3">
        {LINKS.map((link, index) => (
          <div key={link.href} className="row-in" style={rowStyle(index, reduced)}>
            <Link href={link.href} className="focus-ring rounded-xl">
              <Card padding="tight">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-content-muted">
                    <Icon name={link.icon} size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="type-body font-medium">{link.title}</p>
                    <p className="type-label text-content-subtle">{link.body}</p>
                  </div>
                  {link.href === '/home/notifications' && unread > 0 ? (
                    <Badge tone="info" size="sm">{unread}</Badge>
                  ) : (
                    <Icon name="chevron-right" size={18} className="shrink-0 text-content-muted" />
                  )}
                </div>
              </Card>
            </Link>
          </div>
        ))}
      </div>
    </Shell>
  );
}
