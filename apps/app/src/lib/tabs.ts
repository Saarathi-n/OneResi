import type { TabDef } from '@/components/BottomTabs';

/**
 * The resident's five tabs. Phone-shaped: the four things a resident opens the app for, plus More
 * for the long tail. Badge counts are attached per screen where the count is already loaded.
 */
export const RESIDENT_TABS: readonly TabDef[] = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/home/visitors', label: 'Visitors', icon: 'car' },
  { href: '/home/invoices', label: 'Billing', icon: 'wallet' },
  { href: '/home/complaints', label: 'Complaints', icon: 'wrench' },
  { href: '/home/more', label: 'More', icon: 'more' },
];

/** The committee desk's five tabs: the queues the desk works through, plus More. */
export const COMMITTEE_TABS: readonly TabDef[] = [
  { href: '/desk', label: 'Queue', icon: 'users' },
  { href: '/desk/ledger', label: 'Ledger', icon: 'receipt' },
  { href: '/desk/complaints', label: 'Fixes', icon: 'wrench' },
  { href: '/desk/bookings', label: 'Bookings', icon: 'calendar' },
  { href: '/desk/more', label: 'More', icon: 'more' },
];
