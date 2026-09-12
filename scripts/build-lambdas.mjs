#!/usr/bin/env node
/**
 * Builds the two Lambda bundles from the monorepo's TypeScript source, so the notification and
 * overdue rules exist once — in packages/domain and packages/mail — rather than being
 * reimplemented beside the Terraform that deploys them.
 *
 *   node scripts/build-lambdas.mjs
 *
 * Each handler bundles to infra/lambda/<name>-bundle/index.js (gitignored): one ESM file with
 * the workspace packages AND the AWS SDK clients compiled in — the runtime's own SDK copy is a
 * version nobody tested against, and esbuild tree-shakes each client to what the handler calls. `package.json` with `"type": "module"` ships beside it, which is what makes
 * the runtime read the ESM. Point `notifier_bundle_dir` and `overdue_bundle_dir` at the two
 * directories in terraform.tfvars and Terraform zips exactly what is there.
 *
 * `import.meta.dirname` (packages/db/src/env.ts, for the local file's repo root) is defined to a
 * harmless constant: the Lambdas only ever run against the cloud target, and esbuild's ESM output
 * would otherwise leave the bare expression for a runtime that may not define it.
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LAMBDAS = [
  { name: 'notifier', entry: 'infra/lambda/notifier/src/index.ts' },
  { name: 'overdue', entry: 'infra/lambda/overdue/src/index.ts' },
];

for (const lambda of LAMBDAS) {
  const outdir = join(repoRoot, 'infra', 'lambda', `${lambda.name}-bundle`);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: [join(repoRoot, lambda.entry)],
    outfile: join(outdir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    logLevel: 'info',
    define: { 'import.meta.dirname': '"/var/task"' },
    // The handlers live outside the workspace packages, so pnpm's node_modules symlinks are not
    // in their ancestor chain and esbuild cannot resolve the package names on its own. The
    // aliases point each import at the TypeScript source the package's own "exports" names —
    // the same files the apps compile.
    alias: {
      '@oneresi/mail/worker': join(repoRoot, 'packages/mail/src/worker.ts'),
      '@oneresi/mail/push-worker': join(repoRoot, 'packages/mail/src/push-worker.ts'),
      '@oneresi/mail/in-app-worker': join(repoRoot, 'packages/mail/src/in-app-worker.ts'),
      '@oneresi/mail/providers/ses-events': join(repoRoot, 'packages/mail/src/providers/ses-events.ts'),
      '@oneresi/mail/providers/webpush': join(repoRoot, 'packages/mail/src/providers/webpush.ts'),
      '@oneresi/mail': join(repoRoot, 'packages/mail/src/index.ts'),
      '@oneresi/domain': join(repoRoot, 'packages/domain/src/index.ts'),
      '@oneresi/db/generated/postgresql': join(repoRoot, 'packages/db/prisma/generated/postgresql/index.js'),
      '@oneresi/db/generated/sqlite': join(repoRoot, 'packages/db/prisma/generated/sqlite/index.js'),
      '@oneresi/db': join(repoRoot, 'packages/db/src/index.ts'),
      '@oneresi/contracts': join(repoRoot, 'packages/contracts/src/index.ts'),
    },
  });

  // The marker that makes nodejs20.x read the ESM output as modules.
  writeFileSync(join(outdir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

  process.stdout.write(`  ${lambda.name} -> infra/lambda/${lambda.name}-bundle/index.js\n`);
}
