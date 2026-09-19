'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card } from '@grihaone/ui';
import { Icon } from '@/components/icons';
import { Shell } from '@/components/Shell';
import { COMMITTEE_TABS } from '@/lib/tabs';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { rowStyle } from '@/lib/motion';

/**
 * The desk's "everything else" shelf — the surfaces the committee reaches for occasionally rather
 * than hourly, kept off the tab bar so the queues stay one glance away.
 */

const LINKS = [
  {
    href: '/desk/announcements',
    icon: 'megaphone',
    title: 'Announcements',
    body: 'Publish a notice to the whole society, or take one off the board.',
  },
  {
    href: '/desk/property',
    icon: 'building',
    title: 'Property',
    body: 'Blocks and homes — add them, set their charge, retire what is empty.',
  },
  {
    href: '/profile',
    icon: 'user',
    title: 'Your profile',
    body: 'Contact details, password, and signing out.',
  },
] as const;

export default function DeskMorePage(): ReactNode {
  const reduced = useReducedMotion();

  return (
    <Shell title="More" tabs={COMMITTEE_TABS} activeTab="/desk/more">
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
                  <Icon name="chevron-right" size={18} className="shrink-0 text-content-muted" />
                </div>
              </Card>
            </Link>
          </div>
        ))}
      </div>
    </Shell>
  );
}
