# Deploy Playbook — the verified sequence

This is the AWS deploy/verify/destroy cycle as it was actually executed and debugged to green
(2026-09-13, two full cycles, 21/21 live checks, account swept clean, ~$0 billed). It exists so the
next cycle is read-and-run: every trap below was hit for real, and every fix is already in the
committed code — this file is the map of what they were and where they bite.

The runbook (`docs/runbook.md`) covers scripts and day-to-day commands; this file covers the
deployment cycle end to end, including the machine-specific and account-specific facts that
nowhere else records.

---

## 0. Constants and shell quirks (this machine, this account)

| Thing | Value |
|---|---|
| AWS account | `215671569291` |
| Region | `ap-south-1` (Mumbai) — the CLI default must match, or SES verifies identities in the wrong region |
| Stack prefix | `grihaone-dev` |
| State bucket | `grihaone-tfstate-215671569291-ap-south-1` (created by `infra/bootstrap`, once ever) |
| Terraform binary | `C:\Users\ashvi\AppData\Local\Microsoft\WinGet\Packages\Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe\terraform.exe` — a stale 1.9.8 on PATH shadows it; `scripts/cloud.mjs` probes this location first, but call the full path when running terraform by hand |
| Docker binary | `/c/Program Files/Docker/Docker/resources/bin` — export into PATH in Git Bash: `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"` |
| Seed password (deployed) | RANDOM, in SSM `/grihaone/dev/SEED_PASSWORD`. Fetch with the command `terraform output -raw seeded_password_command` prints. NOT the local `starling-marble-97-QUAY` |

Git Bash quirks that cost real time:

- **`MSYS_NO_PATHCONV=1`** must prefix aws CLI commands that carry `/ecs/...`-style paths — Git
  Bash otherwise rewrites them into `C:/Program Files/Git/...` garbage.
- **Docker Desktop must be fully up** before building. If builds die with `npipe` /
  `//./pipe/docker_engine` errors, the engine died — restart Docker Desktop and wait for
  `docker version` to answer from both client and server before retrying.
- **One vitest suite at a time** (see runbook) — the shared `.data/test/template.db` cannot
  survive two concurrent runs.

Account-specific facts (2026-09):

- **CloudFront returns 403 on CreateDistribution** — the account is not verified by AWS Support
  yet. `enable_cloudfront = false` in tfvars serves straight from the ALB over HTTP
  (`ALLOW_HTTP_ORIGIN=true` does the rest). After AWS verifies the account, delete that line.
- **RDS free plan caps backup retention** — `backup_retention_period` is 1, not 7
  (FreeTierRestrictionError at 7).

---

## 1. Pre-flight (local, before touching AWS)

```bash
pnpm install
pnpm bootstrap          # both prisma clients + local migrate + seed
pnpm verify             # typecheck + lint + copy/enum gates
pnpm test               # 600 unit tests — one suite at a time
node scripts/e2e-local.mjs   # 118 E2E checks against local servers
```

All must be green. A deploy of a red tree debugs badly on AWS.

If a browser-side production bug is suspected, remember: **dev mode warns where production
throws** (the session.ts TDZ bug was invisible-ish in dev, fatal in the standalone bundle).

---

## 2. The tfvars checklist

`infra/stack/terraform.tfvars` is gitignored. Fields, in the order `example.tfvars` documents:

| Field | Value for this deployment |
|---|---|
| `notification_email` | `ashvinksg@gmail.com` (budget + CloudWatch alarms land here) |
| `github_repository` | `Ashvin-KS/GrihaOne` |
| `vapid_public_key` / `vapid_private_key` / `vapid_subject` | from `pnpm push:keys` — generate ONCE, keep forever |
| `ses_identity_mode` | `"emails"` (no Route 53 domain) |
| `ses_verified_emails` | `["ashvinksg@gmail.com", "saarathin@gmail.com", "ashvin.ks2024@vitstudent.ac.in"]` — the three real demo mailboxes; each gets a verification link to click |
| `enable_cloudfront` | `false` — until AWS Support verifies the account (see §0) |
| `notifier_bundle_dir` | `../lambda/notifier-bundle` (built in step 3) |
| `overdue_bundle_dir` | `../lambda/overdue-bundle` |
| `allow_destroy_with_data` | **`false` for any deploy you want to keep.** `true` only for a teardown cycle — it disables RDS deletion protection and ECR force_delete guards |

---

## 3. Deploy sequence (verified order — the order exists for reasons)

```bash
# 3a. Lambda bundles FIRST — the apply consumes them.
pnpm lambdas:build        # esbuild-bundles into infra/lambda/{notifier,overdue}-bundle/ (gitignored)

# 3b. The state bucket, once ever. Skip if it already exists.
TF="/c/Users/ashvi/AppData/Local/Microsoft/WinGet/Packages/Hashicorp.Terraform_Microsoft.Winget.Source_8wekyb3d8bbwe/terraform.exe"
cd infra/bootstrap && "$TF" init && "$TF" apply && cd ../..

# 3c. The stack's ECR repository, and ONLY it — images cannot push to a repo that does not
#     exist, and the full apply stops at the migrate step until they are pushed.
cd infra/stack && "$TF" init
"$TF" apply -target=aws_ecr_repository.app -auto-approve

# 3d. Images. `terraform output docker_commands` prints these with the real repo URL.
#     Do NOT rebuild an image whose inputs did not change. A `docker build` of a
#     1.5 GB Next standalone takes ~10 min even when every layer would cache.
#     Skip rules:
#       runtime  — rebuild only if apps/, packages/, or infra/docker changed
#                  since the local `grihaone-app:latest` was built.
#       migrate  — rebuild only if packages/db/prisma, packages/db/scripts, or
#                  infra/docker changed. A domain/PWA/mail-only commit does not
#                  touch migrate. Retag the existing local image and push it.
#     After a full destroy, ECR is gone but local images remain — retag + push,
#     do not rebuild.
export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"
REPO=215671569291.dkr.ecr.ap-south-1.amazonaws.com/grihaone-dev
# Windows Credential Manager often dies after a reboot ("A specified logon
# session does not exist"). Write the token into a throwaway DOCKER_CONFIG
# instead of `docker login`:
mkdir -p /tmp/docker-conf
AUTH=$(aws ecr get-login-password --region ap-south-1 | tr -d '\n' | base64 -w0)
printf '{"auths":{"%s":{"auth":"%s"}}}\n' 215671569291.dkr.ecr.ap-south-1.amazonaws.com "$AUTH" > /tmp/docker-conf/config.json
export DOCKER_CONFIG=/tmp/docker-conf

# Rebuild runtime only when its inputs changed; otherwise retag what you have.
docker build --file infra/docker/Dockerfile --target runtime --tag $REPO:latest .   # skip if grihaone-app:latest is current
docker tag grihaone-app:latest $REPO:latest
docker push $REPO:latest

# Rebuild migrate only when schema/scripts/Dockerfile changed.
docker tag grihaone-app:migrate $REPO:migrate   # or build --target migrate if those inputs changed
docker push $REPO:migrate

# 3e. The full apply. RDS ~5-8 min, the migrate task runs (node interpreter), the service
#     comes up behind the ALB. Failures here are readable, not crash-loops.
"$TF" plan && "$TF" apply

# 3f. The URL and the seed password.
"$TF" output app_url
"$TF" output -raw seeded_password_command   # run what it prints → the SSM seed password
```

### Code-change redeploy (stack already up)

`pnpm lambdas:build` (if `packages/mail` or `infra/lambda` changed) → rebuild **only the
images whose inputs changed** (runtime for apps/packages, migrate for prisma/scripts) →
push those tags → `"$TF" apply`. ECS does a rolling replacement. Migrations run because
Terraform starts the migrate task on every apply — that is cheap even when the migrate
image itself is unchanged.

---

## 4. The trap register — every bug the first cycles shook out

All fixed in code (commit `2624250` + `database.tf`), listed so the symptom is recognizable if
it ever resurfaces. Symptom → cause.

1. **Build dies at `pnpm install` with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`** — pnpm 11
   needs Node ≥ 20.11's `node:sqlite`; the image base was `node:20-alpine`. Fix: `node:24-alpine`.
2. **App image builds but queries fail: `could not locate the Query Engine for runtime
   linux-musl-openssl-3.0.x`** — Next's standalone trace carries the Prisma client JS but not
   the engine binary. Fix: engine copied to `/app/bin/libquery_engine.so.node` +
   `PRISMA_QUERY_ENGINE_LIBRARY` env (in the Dockerfile).
3. **Image built with only the SQLite client** — `DB_TARGET` unset in the container made
   `prisma generate` emit one client. Fix: the wrapper now always generates BOTH clients.
4. **Migrate task EACCES on `generate-schemas.mjs`** — runtime regeneration as non-root.
   Fix: migrate.mjs calls the prisma wrapper directly, schemas are build-time output.
5. **local-exec provisioner: `Cannot find module '...stack\"C:\Developer\OneResi'`** — cmd.exe
   mangled the quoted Windows path. Fix: `interpreter = ["node"]`, script path as one argument.
6. **RDS `FreeTierRestrictionError`** — backup retention 7 exceeds the free-plan cap. Fix: 1.
7. **SG descriptions rejected** — apostrophes/em-dashes outside AWS's allowed charset.
   Fix: ASCII, hyphens only, in every SG description.
8. **ALB answers 403 to everything** — the only listener rule required the CloudFront secret
   header, and there was no CloudFront. Fix: `from_internet` listener rule when
   `enable_cloudfront` is false.
9. **ECS service crash-loops, health check failing** — the target group probes `/api/health`,
   which didn't exist. Fix: route + `apps/web/src/server/health.ts` (does `SELECT 1`).
10. **PWA 404 under `/a`** — the web→app proxy rewrite existed only as a comment, and env-var
    conditional rewrites bake nothing (Next evaluates rewrites at BUILD time). Fix:
    always-defined rewrite pair with build-time port resolution.
11. **App refuses to boot: `APP_ORIGIN must be an https origin`** — no CloudFront means an http
    origin. Fix: `ALLOW_HTTP_ORIGIN=true` (set by Terraform when `enable_cloudfront` is false);
    refresh-cookie `Secure` flag follows it.
12. **CloudFront 403 "account must be verified"** — this AWS account cannot create distributions
    yet. Fix: the `enable_cloudfront` toggle (§0).
13. **Sign-in broken in production: `Cannot access 'accessToken' before initialization`** —
    temporal dead zone: `hydrateFromStorage()` was called before the `let` declarations it
    writes. Dev warned; production threw. Fix: declarations first, call after
    (`apps/web/src/lib/session.ts`).
14. **Deployed sign-in fails with correct password** — the deployed seed password is RANDOM via
    SSM, not the local one. Not a bug: fetch it (§3f).
15. **Terraform state lock `PreconditionFailed`** — an interrupted apply left the DynamoDB lock.
    Fix: `"$TF" force-unlock -force <lock-id>` (the error prints the id).
16. **Destroy hangs ~25 min on Lambda ENI security groups** — AWS's slowest deletion step.
    Expected; wait, do not re-run.

The second deploy cycle (2026-09-14, the SES live test) shook out four more, all in the
notifier Lambda — which no earlier check had ever actually exercised, because nothing had sent
real mail through it:

17. **Notifier Lambda crash-loops: `Dynamic require of "node:https" is not supported`** — the
    esbuild ESM bundle cannot satisfy the AWS SDK's CJS `require()` of node builtins.
    Fix: the `createRequire` banner in `scripts/build-lambdas.mjs`.
18. **Notifier Lambda: `__dirname is not defined`** — Prisma's CJS runtime reads `__dirname`,
    absent in ESM. Fix: `fileURLToPath` lines in the same banner.
19. **Notifier Lambda: `could not locate the Query Engine for runtime rhel-openssl-3.0.x`** —
    the bundle was built on Windows, so the client's native engine is a .dll. Fix:
    `binaryTargets = ["native", "rhel-openssl-3.0.x"]` in the base schema, the engine copied
    into the bundle by build-lambdas.mjs, and `PRISMA_QUERY_ENGINE_LIBRARY` set in events.tf —
    the Lambda twin of trap 2.
20. **RDS connection exhaustion: `remaining connection slots are reserved`** — a db.t4g.micro
    derives ~19 total slots (~14 usable after rds_reserved), and the app's two Next servers
    (uncapped Prisma pools) plus every warm Lambda environment overflow it; even
    `/api/health` is refused, which surfaces in the browser as "Application error".
    Fix: `connection_limit=5` in the container entrypoint's URL, `connection_limit=2` in the
    Lambda URL (packages/db events.ts), and `max_connections=80` in the RDS parameter group.

Two SES facts that are behavior, not bugs:

- **Sandbox refusals are per-recipient**: sending to any unverified address fails with
  "not authorized to perform ses:SendEmail on resource .../identity/<recipient>" — which is
  what happens to the seed's fictional residents. Only verified mailboxes can receive until
  production access is granted. Rows land FAILED and are requeueable afterwards.
- **The live mail suite races the notifier** for messages on the mail-events queue (the Lambda
  is subscribed to the same queue to apply bounce events). To run `pnpm test:mail:live`,
  disable the mapping first:
  `aws lambda update-event-source-mapping --uuid <mail-events-uuid> --no-enabled`,
  run the test, then re-enable. (The uuid: `aws lambda list-event-source-mappings
  --function-name grihaone-dev-notifier`.) The passed run of 2026-09-14 was done exactly this way.

---

## 5. Live verification (the 21-point checklist)

Run against `terraform output app_url` with the SSM seed password. These are the checks that
passed 21/21 on the verified deploy:

1. Marketing page renders (HTTP 200, real content)
2. `/api/health` → `{"ok":true}`
3. PWA `/a` loads; `/a/manifest.webmanifest` valid
4. Sign-in as committee — `ashvinksg@gmail.com`
5. Sign-in as resident — `saarathin@gmail.com`
6. Sign-in as gate — `ashvin.ks2024@vitstudent.ac.in`
7. Resident dashboard
8. Invoices list + detail
9. Dues CSV download (auth headers path)
10. Complaints create/list
11. Facility booking flow
12. Visitor pass flow
13. Notices list
14. Notifications screen
15. `/api/push/key` returns the VAPID public key
16. Committee desk: applications queue (approve/reject present)
17. Committee: billing period list
18. Gate kiosk: walk-in queue (approved visitors remain on site for check-in/out — decided
    visitors are visible by design, the check asserts the decision landed)
19. Committee wall (all sections)
20. Resident wall
21. Gate wall

Mail delivery is checked separately and deliberately last — SES verification links must be
clicked in all three mailboxes first, and `pnpm test:mail:live` needs the stack outputs
(`SES_EVENT_QUEUE_URL` etc.).

---

## 6. Teardown (verified sequence)

```bash
# 6a. Lift the data guards FIRST — destroy refuses while they hold.
#     In infra/stack/terraform.tfvars: allow_destroy_with_data = true
"$TF" apply -auto-approve     # flips RDS deletion_protection + ECR force_delete

# 6b. Destroy the main stack. ~30 min total; the Lambda ENI security groups are the slow
#     tail (~25 min) and are EXPECTED to hang — wait it out.
"$TF" destroy

# 6c. The bootstrap bucket. Its prevent_destroy guard must be lifted deliberately:
#     edit infra/bootstrap/main.tf (remove/comment prevent_destroy on the bucket),
"$TF" destroy
#     then purge every object VERSION (a plain recursive delete misses them):
#     loop aws s3api delete-objects with versioning or the console empty-and-delete
#     then `git checkout infra/bootstrap/main.tf` to restore the guard.

# 6d. Clean local state so the next init is fresh: remove infra/*/.terraform and terraform.tfstate*

# 6e. REMOVE allow_destroy_with_data from tfvars — a future deploy must not carry it.
```

### Post-teardown sweep (prove nothing bills)

```bash
for r in ap-south-1; do
  aws ec2 describe-vpcs --region $r --query 'Vpcs[].VpcId' --output text
  aws ec2 describe-volumes --region $r --query 'Volumes[].VolumeId' --output text
  aws ecs list-clusters --region $r --output text
  aws elbv2 describe-load-balancers --region $r --query 'LoadBalancers[].LoadBalancerName' --output text
  aws rds describe-db-instances --region $r --query 'DBInstances[].DBInstanceIdentifier' --output text
  aws lambda list-functions --region $r --query 'Functions[].FunctionName' --output text
  aws sns list-topics --region $r --output text
  aws sqs list-queues --region $r --output text
  aws secretsmanager list-secrets --region $r --query 'SecretList[].Name' --output text
  aws ecr describe-repositories --region $r --query 'repositories[].repositoryName' --output text
  aws s3api list-buckets --query 'Buckets[].Name' --output text
done
```

Expected end state: only the three pre-existing buckets (`ashvin-24bce1580-flowlogs`,
`ashvin-24bce1580-site`, `not-chosen-before-as-bucket-name`), everything else empty.

### The cost receipt

```bash
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=2026-09-01,End=2026-09-14 --granularity MONTHLY --metrics "UnblendedCost" \
  --query 'ResultsByTime[].Total'
```

Verified after two full cycles + destroy: **~$0.000000074** — effectively zero, against the $10
hard cap. Deploy → verify → destroy within hours is free-tier-clean.

---

## 7. A real launch (deploy and keep running)

Same sequence as §3, with three differences:

1. `allow_destroy_with_data` stays **false** (absent from tfvars).
2. Before it: contact AWS Support to verify the account → set `enable_cloudfront = true` →
   HTTPS, PWA install, and web push work.
3. For mail beyond the three verified mailboxes: request SES production access (console form,
   ~1-2 days review) — the sandbox only sends to verified addresses.

Cost model: fully running ≈ $1.20/hr list, but inside the free-tier year with `cloud:stop`
between demos it lands at single dollars per month; the $5 budget alarm emails
`ashvinksg@gmail.com` long before anything surprises. `pnpm cloud:stop` / `cloud:start` park
and resume the Fargate meter.
