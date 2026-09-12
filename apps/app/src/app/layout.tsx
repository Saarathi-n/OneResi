import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@grihaone/ui';
import './globals.css';
import { SessionProvider } from '@/lib/session';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

/**
 * The installable app's root. Every PWA property the previous build lacked lives here (D-62):
 * the manifest, the icon set, the theme colour, the standalone display, and the Apple web-app
 * metas — so "Add to Home Screen" produces GrihaOne, not a browser bookmark.
 */
export const metadata: Metadata = {
  title: 'GrihaOne',
  applicationName: 'GrihaOne',
  description: 'Maintenance dues, visitor passes, complaints and gate approvals for your community.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'GrihaOne',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1d6853',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-content antialiased">
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
