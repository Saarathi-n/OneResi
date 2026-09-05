import { defineConfig } from 'vitest/config';

/**
 * One configuration, run once per database target. `pnpm test:parity` invokes it twice — see
 * scripts/run-parity.mjs — because a test that only passes on one engine is exactly the class of
 * defect that produced "works locally, 500s on RDS" in the previous build (D-15, D-16).
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    // Database tests get an isolated copy each, but migrations and engine startup are not free.
    pool: 'threads',
    poolOptions: { threads: { singleThread: false } },
    testTimeout: 20_000,
    hookTimeout: 60_000,
    reporters: process.env.CI === 'true' ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/prisma/generated/**'],
    },
  },
});
