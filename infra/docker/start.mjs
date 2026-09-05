/**
 * Starts whichever front ends are in the image and keeps them tied together.
 *
 * Both applications ship in one image because one Fargate task is the only thing that bills. `apps/web`
 * serves `/` and the committee desk and owns the API routes; `apps/app` is the installable PWA under
 * `/a/*`. The load balancer only ever talks to PORT, so the split between them is a rewrite inside
 * `apps/web` pointing at 127.0.0.1:APP_PORT — an in-container hop, not a second target group.
 *
 * A supervisor rather than `&` in a shell script: busybox has no `wait -n`, and a container whose
 * background process died while pid 1 kept running would pass its health check with half the product
 * missing. Here, if either server exits, the container exits, and ECS replaces it.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = '/app/apps';
const port = process.env.PORT ?? '3000';
const appPort = process.env.APP_PORT ?? '3001';

// Ordered on purpose: `web` gets the port the load balancer targets.
const candidates = [
  { name: 'web', port },
  { name: 'app', port: appPort },
];

const servers = candidates
  .map((candidate) => ({ ...candidate, entry: join(root, candidate.name, 'server.js') }))
  .filter((candidate) => existsSync(candidate.entry));

if (servers.length === 0) {
  console.error(
    'No server.js under /app/apps. The image was built before the applications existed, or a next.config ' +
      "is missing output: 'standalone'.",
  );
  process.exit(1);
}

const children = servers.map(({ name, port: assigned, entry }) => {
  console.log(JSON.stringify({ level: 'info', message: `starting ${name}`, port: assigned }));

  const child = spawn(process.execPath, [entry], {
    stdio: 'inherit',
    env: { ...process.env, PORT: assigned, HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0' },
  });

  child.on('exit', (code, signal) => {
    console.error(JSON.stringify({ level: 'error', message: `${name} exited`, code, signal }));
    stop(code ?? 1);
  });

  return child;
});

let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }

  // Long enough for a graceful shutdown, short enough that a redeploy does not sit waiting. The task
  // definition's stopTimeout is 30s, so this stays inside it.
  setTimeout(() => process.exit(code), 10_000).unref();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', message: `received ${signal}, shutting down` }));
    stop(0);
  });
}
