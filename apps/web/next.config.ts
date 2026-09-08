import type { NextConfig } from 'next';

/**
 * The marketing site and the committee's desk, plus every API route. Built into the same
 * container image as @oneresi/app; the task's router sends "/" and "/admin/*" here and "/a/*"
 * to the app. See docs/plan/02-architecture.md.
 */
const nextConfig: NextConfig = {
  // Standalone output is what makes the runtime image small enough to be worth building, and the
  // image is built on Linux (infra/docker/Dockerfile). On Windows it needs directory symlinks the
  // user would have to enable Developer Mode to grant, so local builds take the default output —
  // same app, one less system setting.
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),
};

export default nextConfig;
