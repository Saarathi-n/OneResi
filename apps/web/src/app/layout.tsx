import type { Metadata } from 'next';
import { ToastProvider } from '@oneresi/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'OneResi',
  description: 'Community management that residents actually use.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-content antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
