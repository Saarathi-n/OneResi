import { spawn } from 'node:child_process';

/**
 * The cloud database URL, resolved live from AWS rather than trusted from the server's
 * environment — because the one value in that URL that rotates is the one a human cannot keep
 * current: RDS generates a NEW master password every time the stack is created, so a
 * `DATABASE_URL` exported into the dev server's shell is stale after every deploy → destroy →
 * deploy cycle, and the pre-destroy sync (and the sync screen) then fail with "credentials are
 * not valid" exactly when they matter.
 *
 * Everything here is dev-console only: the routes that call it are 404 in production.
 */

const REGION = 'ap-south-1';
const DB_IDENTIFIER = 'grihaone-dev-postgres';

function runAws(args: readonly string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('aws', [...args, '--region', REGION, '--output', 'json'], {
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (error) => resolve({ code: 1, output: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * The current `DATABASE_URL` for the deployed stack, or null when there is no database to
 * describe (nothing deployed) or AWS could not be reached. The password is percent-encoded the
 * same way the container entrypoint encodes it, because a generated password may contain
 * characters that would terminate the URL's userinfo section.
 */
export async function resolveCloudDatabaseUrl(): Promise<string | null> {
  const instance = await runAws([
    'rds', 'describe-db-instances', '--db-instance-identifier', DB_IDENTIFIER,
  ]);
  if (instance.code !== 0) return null;
  try {
    const parsed = JSON.parse(instance.output) as {
      DBInstances?: {
        Endpoint?: { Address?: string; Port?: number };
        DBName?: string;
        MasterUserSecret?: { SecretArn?: string };
        DBInstanceStatus?: string;
      }[];
    };
    const db = parsed.DBInstances?.[0];
    if (db === undefined) return null;
    const host = db.Endpoint?.Address;
    const secretArn = db.MasterUserSecret?.SecretArn;
    if (host === undefined || secretArn === undefined) return null;
    // Deleting/deleted instances answer with a status but no endpoint worth connecting to.
    if (db.DBInstanceStatus !== undefined && !['available', 'modifying', 'backing-up'].includes(db.DBInstanceStatus)) {
      return null;
    }

    const secret = await runAws(['secretsmanager', 'get-secret-value', '--secret-id', secretArn]);
    if (secret.code !== 0) return null;
    const secretJson = (JSON.parse(secret.output) as { SecretString?: string }).SecretString;
    if (secretJson === undefined) return null;
    const password = (JSON.parse(secretJson) as { password?: string }).password;
    if (password === undefined) return null;

    const encoded = encodeURIComponent(password);
    const port = db.Endpoint?.Port ?? 5432;
    const name = db.DBName ?? 'grihaone';
    return `postgresql://grihaone_admin:${encoded}@${host}:${port}/${name}?sslmode=require`;
  } catch {
    return null;
  }
}
