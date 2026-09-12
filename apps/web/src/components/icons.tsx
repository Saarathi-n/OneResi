import type { ReactNode } from 'react';

/**
 * A minimal stroke icon set for web pages. lucide-react belongs to
 * @oneresi/ui, not to this package, so the glyphs the app needs are drawn here
 * — 24px grid, currentColor, stroke only, so they inherit content colour and tone.
 */

export type IconName =
  | 'eye'
  | 'eye-off'
  | 'check'
  | 'edit'
  | 'building'
  | 'key'
  | 'shield'
  | 'arrow-right'
  | 'chevron-left'
  | 'chevron-right'
  | 'sparkle'
  | 'home'
  | 'bell'
  | 'id-card'
  | 'alert-circle'
  | 'calendar'
  | 'clock'
  | 'share'
  | 'pin';

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  building: (
    <>
      <path d="M5 20.5V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15" />
      <path d="M15 10h3a1 1 0 0 1 1 1v9.5" />
      <path d="M8 8h4M8 11.5h4M8 15h4M3.5 20.5h17" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="8.5" r="3.5" />
      <path d="m11 11 8 8M16 16l2-2M18.5 18.5l1.5-1.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.4 7 9 4.1-1.6 7-4.7 7-9V6z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </>
  ),
  'arrow-right': <path d="M5 12h14M12 5l7 7-7 7" />,
  'chevron-left': <path d="m14.5 6-5.5 6 5.5 6" />,
  'chevron-right': <path d="m9.5 6 5.5 6-5.5 6" />,
  home: (
    <>
      <path d="M4 11.5 12 4.5l8 7" />
      <path d="M6 10.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1v-8.5" />
    </>
  ),
  sparkle: (
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  'id-card': (
    <>
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M15 9h2M15 13h2M7 16a2 2 0 0 1 4 0" />
    </>
  ),
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ),
  calendar: (
    <>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </>
  ),
  pin: (
    <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A1 1 0 0 0 6.5 15h11a1 1 0 0 0 .39-1.55l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2z" />
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
