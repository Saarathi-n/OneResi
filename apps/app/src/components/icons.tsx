import type { ReactNode } from 'react';

/**
 * A minimal stroke icon set for the tab bar and inline affordances. lucide-react belongs to
 * @oneresi/ui, not to this package, so the handful of glyphs the app itself needs are drawn here
 * — 24px grid, currentColor, stroke only, so they inherit content colour and tone.
 */

export type IconName =
  | 'home'
  | 'users'
  | 'receipt'
  | 'wrench'
  | 'more'
  | 'bell'
  | 'building'
  | 'shield'
  | 'clipboard'
  | 'logout'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'close'
  | 'clock'
  | 'phone'
  | 'megaphone'
  | 'wallet'
  | 'plus'
  | 'refresh'
  | 'offline'
  | 'user'
  | 'calendar'
  | 'car'
  | 'mail'
  | 'key'
  | 'camera';

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  home: (
    <>
      <path d="M4 11.5 12 4.5l8 7" />
      <path d="M6 10.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1v-8.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7" />
      <path d="M16 6a3 3 0 0 1 0 5.6M17.8 14.9c2 .6 3.3 2.2 3.7 4.6" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6L8.4 20.5 6 19z" />
      <path d="M9 8h6M9 11.5h6M9 15h4" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.5 6.5a3.8 3.8 0 0 1 5.2 4.9l-9.4 9.4a2.4 2.4 0 0 1-3.4-3.4l9.4-9.4a3.8 3.8 0 0 1-1.8-1.5z" />
      <path d="M7 13.5 4 10.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" />
      <path d="M10 21h4" />
    </>
  ),
  building: (
    <>
      <path d="M5 20.5V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15" />
      <path d="M15 10h3a1 1 0 0 1 1 1v9.5" />
      <path d="M8 8h4M8 11.5h4M8 15h4M3.5 20.5h17" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.4 7 9 4.1-1.6 7-4.7 7-9V6z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5.5" y="4.5" width="13" height="16" rx="1.5" />
      <path d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7z" />
      <path d="M9 10h6M9 13.5h6M9 17h4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H7a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 7 19.5h7" />
      <path d="M10.5 12h9M16.5 8.5l3 3.5-3 3.5" />
    </>
  ),
  'chevron-left': <path d="m14.5 6-5.5 6 5.5 6" />,
  'chevron-right': <path d="m9.5 6 5.5 6-5.5 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  phone: (
    <path d="M8.5 3.5 10 7l-2 1.8c.7 2 2.2 3.6 4.2 4.4l1.7-2.1 3.6 1.4-.6 3.4c-.2 1-1.1 1.7-2.1 1.6C9.3 16.9 5.4 13 4.5 7.7c-.1-1 .5-2 1.5-2.2z" />
  ),
  megaphone: (
    <>
      <path d="M4 10.5v3l12 5v-13z" />
      <path d="M16 8.5a3.5 3.5 0 0 1 0 7" />
      <path d="M7 13v4.5a1.5 1.5 0 0 0 3 0V14" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5z" />
      <path d="M15.5 12h2" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.5-5.4" />
      <path d="M17 3.5V7h-3.5" />
    </>
  ),
  offline: (
    <>
      <path d="M4 9.5c4.5-4 11.5-4 16 0" />
      <path d="M7 13c2.6-2.3 7.4-2.3 10 0" />
      <path d="M10 16.5c1.2-1 2.8-1 4 0" />
      <path d="M4 4l16 16" strokeDasharray="2 2.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4.5" y="6" width="15" height="14" rx="1.5" />
      <path d="M4.5 10.5h15M8.5 4v3M15.5 4v3" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5v-4l1.8-4.4A1.5 1.5 0 0 1 8.2 7h7.6a1.5 1.5 0 0 1 1.4.9L19 12.5v4" />
      <path d="M5 12.5h14" />
      <circle cx="8" cy="16.5" r="1.6" />
      <circle cx="16" cy="16.5" r="1.6" />
    </>
  ),
  mail: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="1.5" />
      <path d="m5 7.5 7 5.5 7-5.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="8.5" r="3.5" />
      <path d="m11 11 8 8M16 16l2-2M18.5 18.5l1.5-1.5" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5l-1.5 2.5H5A1.5 1.5 0 0 0 3.5 8v9A1.5 1.5 0 0 0 5 18.5h14A1.5 1.5 0 0 0 20.5 17V8A1.5 1.5 0 0 0 19 6.5h-3L14.5 4Z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
