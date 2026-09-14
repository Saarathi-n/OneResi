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
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    // ESM output has neither `require` nor `__dirname`, but two CJS consumers in the bundle need
    // both at module load: the AWS SDK's internals (`@smithy/node-http-handler`) require
    // `node:https`/`node:http`, and Prisma's generated runtime reads `__dirname` to find its
    // engine. The banner supplies the three from `import.meta` — the standard fix for esbuild
    // ESM + AWS SDK + Prisma. Without it the Lambda answers "Dynamic require of \"node:https\"
    // is not supported" or "__dirname is not defined" on first invocation and every SQS batch
    // redelivers forever.
    banner: {
      js: [
        "import { createRequire } from 'node:module';",
        "import { fileURLToPath } from 'node:url';",
        "const require = createRequire(import.meta.url);",
        "const __filename = fileURLToPath(import.meta.url);",
        "const __dirname = fileURLToPath(new URL('.', import.meta.url));",
      ].join('\n'),
    },
    // The handlers live outside the workspace packages, so pnpm's node_modules symlinks are not
    // in their ancestor chain and esbuild cannot resolve the package names on its own. The
    // aliases point each import at the TypeScript source the package's own "exports" names —
    // the same files the apps compile.
    alias: {
      '@grihaone/mail/worker': join(repoRoot, 'packages/mail/src/worker.ts'),
      '@grihaone/mail/push-worker': join(repoRoot, 'packages/mail/src/push-worker.ts'),
      '@grihaone/mail/in-app-worker': join(repoRoot, 'packages/mail/src/in-app-worker.ts'),
      '@grihaone/mail/providers/ses-events': join(repoRoot, 'packages/mail/src/providers/ses-events.ts'),
      '@grihaone/mail/providers/webpush': join(repoRoot, 'packages/mail/src/providers/webpush.ts'),
      '@grihaone/mail': join(repoRoot, 'packages/mail/src/index.ts'),
      '@grihaone/domain': join(repoRoot, 'packages/domain/src/index.ts'),
      '@grihaone/db/generated/postgresql': join(repoRoot, 'packages/db/prisma/generated/postgresql/index.js'),
      '@grihaone/db/generated/sqlite': join(repoRoot, 'packages/db/prisma/generated/sqlite/index.js'),
      '@grihaone/db': join(repoRoot, 'packages/db/src/index.ts'),
      '@grihaone/contracts': join(repoRoot, 'packages/contracts/src/index.ts'),
    },
  });

  // The marker that makes nodejs20.x read the ESM output as modules.
  writeFileSync(join(outdir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

  // The Prisma query engine for Amazon Linux. The bundle is compiled on Windows, so the client's
  // "native" engine is a .dll it can never use in Lambda; the schema's binaryTargets makes
  // `prisma generate` also emit the rhel engine, and shipping it beside the handler plus
  // PRISMA_QUERY_ENGINE_LIBRARY (set in events.tf) is what lets the Lambda query at all — the
  // same arrangement the container image uses for linux-musl.
  const engines = readdirSync(join(repoRoot, 'packages/db/prisma/generated/postgresql')).filter(
    (name) => name.startsWith('libquery_engine-rhel-openssl-3.0.x'),
  );
  if (engines.length === 0) {
    throw new Error(
      'No rhel-openssl-3.0.x query engine found in packages/db/prisma/generated/postgresql. ' +
        'Run `pnpm db:generate` (the schema now lists rhel-openssl-3.0.x in binaryTargets).',
    );
  }
  for (const engine of engines) {
    copyFileSync(
      join(repoRoot, 'packages/db/prisma/generated/postgresql', engine),
      join(outdir, engine),
    );
  }

  process.stdout.write(`  ${lambda.name} -> infra/lambda/${lambda.name}-bundle/index.js\n`);
}
