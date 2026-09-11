#!/usr/bin/env node
/**
 * The four cloud commands the plan promises — up, down, stop, start — plus env, the one that
 * turns the stack's outputs into the DATABASE_URL a laptop needs to run `DB_TARGET=cloud`.
 *
 * These are wrappers, not magic: every one ends in a Terraform or AWS CLI invocation you could
 * have typed yourself. Terraform is invoked by full path on purpose — a stale 1.9.8 in ~/bin
 * shadows the installed 1.15.8 (D-79), and this machine's PATH is the user's to manage, not
 * this script's.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const stack = join(repo, 'infra', 'stack');

const TERRAFORM_CANDIDATES = [
  process.env.TERRAFORM_PATH,
  process.env.LOCALAPPDATA === undefined
    ? undefined
    : String.raw`${process.env.LOCALAPPDATA}\Microsoft\WinGet\Packages\Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe\terraform.exe`,
  '/usr/local/bin/terraform',
  'terraform',
].filter((p) => typeof p === 'string' && p !== 'undefined');

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { cwd: stack, encoding: 'utf8', ...options });
}

/** First usable terraform. Bare `terraform` is the last resort because of D-79. */
function terraformPath() {
  const tried = [];
  for (const candidate of TERRAFORM_CANDIDATES) {
    if (candidate !== 'terraform' && !existsSync(candidate)) {
      tried.push(`${candidate} — not found`);
      continue;
    }
    return candidate;
  }
  throw new Error(`No terraform found. Tried:\n  ${tried.join('\n  ')}`);
}

function terraform(args, inherit = true) {
  return run(terraformPath(), args, inherit ? { stdio: 'inherit', encoding: undefined } : {});
}

const command = process.argv[2];

const HELP = `
  cloud:up      terraform apply, then print the URL
  cloud:down    terraform destroy
  cloud:stop    desired_count 0 — keeps everything, stops the only meter
  cloud:start   desired_count 1
  cloud:env     print the export line for DATABASE_URL, from the stack's outputs and Secrets Manager

  TERRAFORM_PATH overrides the binary location if the PATH problem is fixed differently.
`;

async function main() {
  switch (command) {
    case 'up':
      terraform(['apply', '-auto-approve']);
      process.stdout.write(`\n  ${terraform(['output', '-raw', 'app_url']).trim()}\n\n`);
      break;
    case 'down':
      terraform(['destroy', '-auto-approve']);
      break;
    case 'stop':
      terraform(['apply', '-auto-approve', '-var', 'desired_count=0']);
      break;
    case 'start':
      terraform(['apply', '-auto-approve', '-var', 'desired_count=1']);
      break;
    case 'env': {
      // RDS keeps the master password in a secret Terraform cannot read back. The endpoint and
      // the secret's ARN are outputs; the password comes from Secrets Manager, and the two are
      // joined here into the one URL the db package accepts.
      const endpoint = terraform(['output', '-raw', 'database_endpoint']).trim();
      const secretArn = terraform(['output', '-raw', 'database_secret_arn']).trim();
      // The region is named here, never inherited from the CLI's default: the stack lives in
      // ap-south-1 and a CLI configured for any other region answers ResourceNotFoundException
      // for a secret that exists (D-78's lesson, one layer up).
      const secret = JSON.parse(
        run('aws', [
          'secretsmanager',
          'get-secret-value',
          '--secret-id',
          secretArn,
          '--region',
          'ap-south-1',
          '--query',
          'SecretString',
          '--output',
          'text',
        ]),
      );
      const url = `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${endpoint}/oneresi?sslmode=require`;
      process.stdout.write(`\n  # one line, one shell:\n  export DATABASE_URL='${url.replace(/'/g, "'\\''")}'\n  export DB_TARGET=cloud\n\n`);
      break;
    }
    default:
      process.stdout.write(HELP);
      process.exitCode = command === undefined ? 1 : 0;
  }
}

main().catch((failure) => {
  process.stderr.write(`\n  cloud ${command ?? ''} failed: ${failure.message}\n\n`);
  process.exitCode = 1;
});
