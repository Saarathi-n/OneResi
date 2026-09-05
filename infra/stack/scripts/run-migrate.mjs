#!/usr/bin/env node
/**
 * Runs the one-off migrate-and-seed task and waits for it, so `terraform apply` cannot report success
 * over a database with no tables in it (D-19).
 *
 * Terraform invokes this from a local-exec provisioner on `terraform_data.migrate`, ordered after the
 * instance is available and before the service scales up. Everything it needs arrives in the
 * environment; there are no arguments.
 *
 * Node rather than a shell script because this repository already needs Node 20 everywhere, and one
 * file that behaves the same on Windows and in CI beats a .sh and a .ps1 that drift.
 */
import { spawnSync } from 'node:child_process';

const env = (name) => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} was not set by Terraform`);
  return value;
};

const region = env('AWS_REGION');
const cluster = env('CLUSTER');
const taskDefinition = env('TASK_DEFINITION');
const containerName = env('CONTAINER_NAME');
const subnets = env('SUBNET_IDS');
const securityGroups = env('SECURITY_GROUPS');
const repository = env('ECR_REPOSITORY');
const repositoryUrl = env('REPOSITORY_URL');
const imageTag = env('IMAGE_TAG');
const appImageTag = env('APP_IMAGE_TAG');
const logGroup = env('LOG_GROUP');
const timeoutMs = Number(process.env.TIMEOUT_SECONDS ?? '900') * 1000;

const log = (line) => process.stdout.write(`  ${line}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The AWS CLI, as JSON. Returns null when the call fails, so callers can give a better message. */
function aws(args) {
  const quoted = args.map((arg) => `"${arg}"`).join(' ');
  const result = spawnSync(`aws ${quoted} --region "${region}" --output json`, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    return null;
  }
  return result.stdout.trim() === '' ? {} : JSON.parse(result.stdout);
}

function fail(message) {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

// The image has to exist before a task can run it. Saying so plainly, with the commands that fix it,
// beats an ECS task that stops with CannotPullContainerError three minutes from now. This is also the
// expected outcome of the very first apply, which creates the repository the images have to go into.
const images = aws(['ecr', 'describe-images', '--repository-name', repository, '--image-ids', `imageTag=${imageTag}`]);
if (images === null) {
  const registry = repositoryUrl.split('/')[0];
  fail(
    `${repositoryUrl}:${imageTag} is not in ECR yet.\n\n` +
      `  Build and push both images from the repository root, then run terraform apply again.\n` +
      `  The service has not been created, so nothing is running against an empty database.\n\n` +
      `    aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}\n` +
      `    docker build --file infra/docker/Dockerfile --target runtime --tag ${repositoryUrl}:${appImageTag} .\n` +
      `    docker push ${repositoryUrl}:${appImageTag}\n` +
      `    docker build --file infra/docker/Dockerfile --target migrate --tag ${repositoryUrl}:${imageTag} .\n` +
      `    docker push ${repositoryUrl}:${imageTag}`,
  );
}

log(`running ${taskDefinition.split('/').pop()}`);

const started = aws([
  'ecs',
  'run-task',
  '--cluster',
  cluster,
  '--task-definition',
  taskDefinition,
  '--launch-type',
  'FARGATE',
  '--started-by',
  'terraform',
  '--network-configuration',
  `awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${securityGroups}],assignPublicIp=ENABLED}`,
]);

if (started === null || started.tasks === undefined || started.tasks.length === 0) {
  const reason = started?.failures?.map((f) => `${f.arn ?? ''} ${f.reason}`).join('; ') ?? 'unknown';
  fail(`The migrate task did not start: ${reason}`);
}

const taskArn = started.tasks[0].taskArn;
const taskId = taskArn.split('/').pop();
log(`task ${taskId} — migrations then the seed, which is convergent, so this runs on every apply`);

const deadline = Date.now() + timeoutMs;
let task = started.tasks[0];

while (task.lastStatus !== 'STOPPED') {
  if (Date.now() > deadline) {
    fail(
      `The migrate task was still ${task.lastStatus} after ${timeoutMs / 1000}s.\n` +
        `  aws logs tail ${logGroup} --region ${region} --since 20m`,
    );
  }
  await sleep(10_000);

  const described = aws(['ecs', 'describe-tasks', '--cluster', cluster, '--tasks', taskArn]);
  if (described === null || described.tasks === undefined || described.tasks.length === 0) {
    fail(`Lost track of task ${taskId}. Check the console.`);
  }
  task = described.tasks[0];
}

const container = (task.containers ?? []).find((c) => c.name === containerName) ?? task.containers?.[0];
const exitCode = container?.exitCode;

if (exitCode !== 0) {
  fail(
    `Migrations failed: exit ${exitCode ?? 'none'}${task.stoppedReason ? ` (${task.stoppedReason})` : ''}.\n` +
      `  The service was not started, so nothing is serving a half-migrated database.\n\n` +
      `    aws logs tail ${logGroup} --region ${region} --since 20m --filter-pattern migrate`,
  );
}

log('schema and seed applied');
