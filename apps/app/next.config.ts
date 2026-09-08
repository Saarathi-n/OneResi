import type { NextConfig } from 'next';

/**
 * The installable PWA — residents and the gate. Served under /a/ from the same container image
 * as @oneresi/web, which is also where the service worker's scope ends: the marketing site must
 * never land in the offline cache. See docs/plan/02-architecture.md.
 */
const nextConfig: NextConfig = {
  basePath: '/a',
  // Standalone output is what makes the runtime image small enough to be worth building, and the
  // image is built on Linux (infra/docker/Dockerfile). On Windows it needs directory symlinks the
  // user would have to enable Developer Mode to grant, so local builds take the default output —
  // same app, one less system setting.
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),
};

export default nextConfig;
