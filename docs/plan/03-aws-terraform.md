# 03 — AWS and Terraform

Region `ap-south-1`. Account `215671569291`, IAM user `Ashvin`, keys already configured.
Terraform 1.9.8 installed — **upgrade to 1.10 or later** before starting, so state can lock in S3
without a DynamoDB table (D-79). Set the CLI default region to `ap-south-1` (D-78).

Target: `terraform apply` produces a working HTTPS URL with a migrated, seeded database and real
outbound mail, and `terraform destroy` leaves nothing billing. Your involvement is the two
commands and a handful of one-time things AWS will not let a machine do.

## What only you can do

Everything else in this document is automated. This is the honest list.

| Thing | Why it cannot be automated | When |
|---|---|---|
| `terraform apply` / `destroy` | It is your decision to spend money | Each session |
| Confirm the budget email address | AWS Budgets sends a subscription confirmation you must click | Once |
| **Either** click SES verification links in 3–5 demo inboxes | AWS emails the mailbox owner; nothing can click for them | Once, per address |
| **or** buy a domain in Route 53 (~₹1,000/yr) | Purchase requires your payment consent | Once — then verification is fully automatic |
| Request SES production access, if you want to mail unverified addresses | A human at AWS reviews the request | Once, optional |

The domain choice is the only real fork. With a Route 53 domain, Terraform creates the SES domain
identity, writes the DKIM and MAIL FROM records itself, and the **sending** identity verifies with
nothing to click. Without one, you click a link in each address you want to send *from* or *to*.

Two separate things, worth keeping apart because they have different answers:

| | What removes it |
|---|---|
| Verifying the address you send **from** | A Route 53 domain — fully automatic. Otherwise one click. |
| SES sandbox restricting who you can send **to** | Production access only. A domain does not lift it. |

So in sandbox you verify each demo mailbox once, whether or not you own a domain. Production access
is the only thing that removes that, and it is a short form reviewed by a person — usually a day.
It is free, and it is the only item in this plan with a lead time, so file it early if you want it.
Sandbox is perfectly demonstrable without it: mail really sends, really arrives, and the limitation
is already recorded in `architecture.md`.

Note: `enable_alb` currently defaults to false, there is no certificate, and the login cookie is
`Secure`, so the present configuration cannot log anyone in over its plain-HTTP address (D-08).
HTTPS is not optional, and it is the one thing a domain is not needed for — see below.

## HTTPS without buying anything

CloudFront in front of the load balancer. The distribution gets a free
`*.cloudfront.net` certificate, so the browser sees valid TLS, the `Secure` cookie is sent, and
login works. CloudFront's free tier covers this volume completely, and it terminates closer to the
user than a Mumbai-only ALB would.

```
browser ──HTTPS──> CloudFront ──HTTP──> ALB ──> Fargate task ──> RDS (private)
                   free cert            :443     :3000
```

If you do buy a domain, the same distribution takes an ACM certificate validated automatically by
a Route 53 record, and you get `oneresi.in` instead of a CloudFront hostname. Same Terraform, one
variable.

## The stack

Two directories. `infra/bootstrap` is applied once, with local state, and creates only the state
bucket. `infra/stack` is everything else and keeps its state in that bucket.

### bootstrap

- S3 bucket, versioned, encrypted, public access blocked — Terraform state
- `use_lockfile = true` on the backend, so no DynamoDB table

Applied once, ever. Its own state file is small enough to commit or keep.

### stack — cost guard first

- `aws_budgets_budget` at **$5**, with both `ACTUAL` at 80% and `FORECASTED` at 100%, so you hear
  about a problem before it has happened rather than after. `time_period_start` computed from
  `timestamp()`, not hardcoded to a date in the past (D-01 in the infra sense).
- A CloudWatch billing alarm as a second, independent signal.

Both notify a real address you supply in `terraform.tfvars`. The current default is
`ashvin@example.com`, which means the only guardrail against runaway cost is pointed at a
non-existent mailbox. Terraform will refuse to plan without a real one.

### network

Keeps the existing shape, which is sound: one VPC, two public subnets, two private subnets, no NAT
gateway. Additions:

- A private route table, explicitly associated, so the private subnets are private by design rather
  than by omission.
- `name_prefix = "${project}-${environment}"` on every nameable resource, so the stack can exist
  twice (D-49).

### database

- `db.t4g.micro`, 20 GB gp3, single AZ — unchanged, free tier.
- `manage_master_user_password = true`. RDS generates the password into Secrets Manager and rotates
  it. **The password never exists in Terraform state, in a variable, or in an environment
  variable** (D-10).
- `backup_retention_period = 7` and `storage_encrypted = true` (D-32).
- `engine_version = "16"` with `auto_minor_version_upgrade`, so a deprecated patch release does not
  break `apply` a month from now.
- A parameter group with `rds.force_ssl = 1`, and `sslmode=require` in the connection string.
- Publicly accessible only when `var.allow_developer_db_access` is true, and then only from a
  single security-group rule holding **your current public IP**, discovered by Terraform at plan
  time. That is how `db:pull` and `db:push` reach RDS from your laptop without a bastion, a NAT
  gateway or a VPC endpoint.

### schema and seed, automatically

This is the gap that would otherwise leave you with a provisioned database containing no tables
(D-19).

A second container in the task definition, or a standalone one-off task, that runs
`prisma migrate deploy` followed by the idempotent seed, and exits. Terraform runs it with
`aws_ecs_task_definition` + a `null_resource` invoking `aws ecs run-task --wait`, ordered after the
instance is available and before the service scales up. It runs inside the VPC, so RDS needs no
public exposure for this path.

The seed is convergent (D-45), so this is safe on every apply, not just the first.

### application

- **ECR repository** with a lifecycle policy keeping the last three images.
- **Multi-stage `Dockerfile`** on Next.js `output: 'standalone'`, non-root user, both apps built
  into one image (D-09).
- **ALB** — HTTP listener, target group on 3000, health check on `/api/health`, which the app must
  actually implement and which must check the database.
- **CloudFront** — the certificate, plus caching for static assets and pass-through for everything
  else.
- Fargate security group ingress **from the ALB security group only**, not `0.0.0.0/0`. This is
  what `architecture.md` already claims and the code does not do.
- `desired_count` from a variable defaulting to 1, with `pnpm cloud:stop` / `cloud:start` wrappers
  around `update-service --desired-count`, which is the scale-to-zero story the ADR relies on for
  cost.
- **A task role** with least privilege: `s3:GetObject`/`PutObject` on one bucket prefix,
  `sns:Publish` on one topic, `ses:SendEmail` scoped to the verified identity, `ssm:GetParameters`
  on `/oneresi/*`, `secretsmanager:GetSecretValue` on the RDS secret. Without this nothing can
  reach any AWS service (D-11).
- `deployment_circuit_breaker` with rollback, and a container health check, so a crash-looping
  task fails the deploy instead of succeeding forever.
- Environment via `secrets` from SSM and Secrets Manager, never `environment`, and including
  `DB_TARGET=cloud`, `JWT_SECRET`, `EMAIL_DRIVER=ses`, `STORAGE_DRIVER=s3`, `EVENT_DRIVER=sns`.
  The current omission of `USE_MOCK_DB` is why the cloud build would ignore RDS entirely (D-06).

### mail

- `aws_sesv2_email_identity` — a domain identity when you have one, otherwise one per demo address.
- With a domain: `aws_route53_record` for the three DKIM CNAMEs and the custom MAIL FROM, written
  by Terraform from the identity's own outputs. Verification then completes with nothing to click.
- A **configuration set** with an event destination publishing `SEND`, `DELIVERY`, `BOUNCE`,
  `COMPLAINT` and `REJECT` to SNS, which feeds an SQS queue. This is not decoration: it is what the
  mail test suite drains to assert that a message actually left AWS and arrived (05).
- Account-level suppression list enabled, so a bounce does not become a repeated send.
- SES sits in **sandbox** until you request otherwise. In sandbox you can send only to verified
  addresses, which is already recorded as a limitation. Everything else works.

### events and scheduled work

- SNS topic → SQS queue → **notifier Lambda** → SES + notification rows. Redrive policy to a dead
  letter queue after three attempts, with an alarm on DLQ depth.
- **EventBridge Scheduler**, 00:30 IST daily → **overdue-flag Lambda** inside the VPC. This
  replaces the unauthenticated `/api/cron/overdue` endpoint, which disappears (D-36).
- Both Lambdas from the monorepo, sharing `packages/domain` and `packages/db`, so the overdue rule
  exists once.

### storage

- Private bucket, versioning on, SSE-S3, public access blocked (already correct).
- **CORS rules** for the browser's presigned `PUT`, which the current bucket lacks and which the
  documented upload design requires.
- Lifecycle rule expiring CSV exports after 30 days.
- `force_destroy` behind a variable, defaulting **off** for anything not tagged `environment=dev`,
  so a stray `destroy` cannot silently delete complaint photos.

### observability

- CloudWatch log group, 7-day retention as documented, not the current 1.
- Alarms: ALB 5xx rate, target health, RDS free storage, RDS CPU, DLQ depth, Lambda errors — to an
  ops SNS topic on your email.
- Container Insights off. It is not free and adds nothing here.

## CI

`.github/workflows/` does not exist today, though `architecture.md` describes it in detail.

- **Pull request** — install, typecheck, lint, the copy gate from 04, unit and integration suites
  against *both* database targets, `terraform plan`.
- **Merge to main** — build the image, push to ECR, run the migrate task, update the service, wait
  for stability, then a smoke test against the CloudFront URL.
- Authentication by OIDC role assumption. No stored AWS keys, which is what ADR 0001 commits to.
  This needs one IAM role with a GitHub trust policy, created by Terraform.

CI is a phase-5 item. Nothing before it is blocked on CI existing.

## Cost

| | Continuous | Scaled to zero between sessions |
|---|---|---|
| Fargate 0.25 vCPU / 0.5 GB | ~$9/mo | a few cents per session |
| ALB | free 12 months, then ~$18/mo | same |
| CloudFront | $0 at this volume | $0 |
| RDS `db.t4g.micro` + 20 GB | free 12 months | free |
| S3, SNS, SQS, Lambda, SSM, SES, Budgets, EventBridge | $0 | $0 |
| Route 53 hosted zone, if you buy a domain | $0.50/mo + ~₹1,000/yr | same |

Fargate and, after the free year, the ALB are the only lines that move. `pnpm cloud:stop` sets
desired count to zero and is the difference between $9 a month and pennies.

Free tier terms change. Confirm in the billing console rather than trusting this table.

## Two commands

```
pnpm cloud:up      # terraform apply, wait for the migrate task, print the URL
pnpm cloud:down    # terraform destroy, confirm nothing remains
pnpm cloud:stop    # desired count 0 — keeps everything, stops the only meter
pnpm cloud:start   # desired count 1
```

`cloud:up` ends by printing the URL, the seeded administrator's credentials, and a reminder of
whether SES is still in sandbox. `cloud:down` ends by listing any resource it could not delete,
rather than printing "zero ongoing charges" unconditionally the way `teardown.ps1` does today.

