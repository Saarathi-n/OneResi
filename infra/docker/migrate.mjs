/**
 * Migrations, then the seed. The command the one-off ECS task runs.
 *
 * Terraform starts this task on every apply, after the instance is available and before the service
 * scales up, and fails the apply if it exits non-zero (see `terraform_data.migrate`). Without it you get
 * a provisioned database with no tables in it, sitting in private subnets a laptop cannot reach, and a
 * deploy script that prints "Provisioning complete" anyway (D-19).
 *
 * Both steps go through the repository's own scripts rather than calling Prisma directly, so the schema
 * path and the connection string are resolved by exactly the same code that resolves them locally —
 * `packages/db/scripts/target.mjs`. One definition of what "cloud" means.
 *
 * The seed is convergent: every write is an upsert on a natural key, so running it on every apply
 * leaves the same rows rather than duplicating half of them (D-45). SEED_PASSWORD arrives as a secret
 * from SSM, so the deployed demo accounts do not share a password with every checkout of the repository.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  { label: 'prisma migrate deploy', args: ['--filter', '@oneresi/db', 'migrate'] },
  { label: 'seed', args: ['--filter', '@oneresi/db', 'seed'] },
];

if (process.env.DB_TARGET !== 'cloud') {
  process.stderr.write(`Refusing to run: DB_TARGET is "${process.env.DB_TARGET ?? 'unset'}", expected "cloud".\n`);
  process.exit(1);
}

for (const step of steps) {
  process.stdout.write(`\n== ${step.label} ==\n`);

  const result = spawnSync('pnpm', step.args, {
    cwd: '/build',
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (result.error !== undefined) {
    process.stderr.write(`${step.label} could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`\n${step.label} failed with exit ${result.status}.\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\nSchema and seed applied.\n');
