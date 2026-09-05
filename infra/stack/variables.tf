########################################################################################################
# Values you must supply live at the top. Everything below them has a working default.
# `example.tfvars` comments every one of them.
########################################################################################################

variable "notification_email" {
  type        = string
  description = <<-EOT
    Where the $5 budget alarm, the forecast alarm and every CloudWatch alarm are sent. There is no
    default on purpose: the previous stack defaulted to `ashvin@example.com`, so the only guardrail
    against runaway cost pointed at a mailbox nobody reads. Terraform refuses to plan without it.
  EOT

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[a-zA-Z]{2,}$", var.notification_email))
    error_message = "notification_email must be a single valid email address."
  }

  validation {
    condition     = !can(regex("(?i)@(example|test|invalid|localhost|domain)\\.", var.notification_email))
    error_message = "notification_email must be a real mailbox you can open, not an example.com placeholder. You have to click a confirmation link in it."
  }
}

variable "github_repository" {
  type        = string
  description = <<-EOT
    `owner/repo` for the GitHub Actions deploy role's trust policy. The workflows themselves belong
    to another stream; the IAM role they assume over OIDC is created here, because only Terraform
    can make it (ADR 0001 commits to no stored AWS keys).
  EOT

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/repo."
  }
}

########################################################################################################
# Naming and placement
########################################################################################################

variable "aws_region" {
  type        = string
  default     = "ap-south-1"
  description = "Mumbai. The AWS CLI default must match it, or an SES identity gets verified in the wrong region (D-78)."
}

variable "project_name" {
  type        = string
  default     = "oneresi"
  description = "First half of every resource name."
}

variable "environment" {
  type        = string
  default     = "dev"
  description = <<-EOT
    Second half of every resource name, through `local.name_prefix`. The previous stack used this in
    tag maps only, so a second environment collided on the RDS identifier, the cluster, the log
    group and the budget (D-49).
  EOT

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,12}$", var.environment))
    error_message = "environment must be lowercase letters, digits and dashes, 2 to 13 characters."
  }
}

########################################################################################################
# Cost
########################################################################################################

variable "budget_limit_usd" {
  type        = string
  default     = "5"
  description = "Monthly ceiling in USD. Notifies at 80% actual and 100% forecast, and the CloudWatch billing alarm uses the same number."
}

variable "desired_count" {
  type        = number
  default     = 1
  description = <<-EOT
    Running tasks. Fargate is the only line item that bills continuously, so 0 between sessions is
    the difference between ~$9 a month and a few cents. `cloud:stop` and `cloud:start` move it with
    the CLI; the next apply restores this value.
  EOT

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 4
    error_message = "desired_count must be between 0 and 4. Anything above 1 is not free-tier behaviour."
  }
}

variable "allow_destroy_with_data" {
  type        = bool
  default     = false
  description = <<-EOT
    Lets `terraform destroy` take the uploads bucket, the ECR images and the database with it, with
    no final snapshot. Ignored unless `environment` is exactly "dev", so a stray destroy in any
    other environment cannot silently delete complaint photos.
  EOT
}

########################################################################################################
# Application runtime
########################################################################################################

variable "task_cpu" {
  type        = number
  default     = 256
  description = "Fargate CPU units. 256 is 0.25 vCPU, which is what the cost table in architecture.md assumes."
}

variable "task_memory" {
  type        = number
  default     = 512
  description = "Fargate memory in MiB. 512 is the smallest that pairs with 256 CPU units."
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = <<-EOT
    Tag of the application image in this stack's ECR repository. The image must exist before the
    service can start: build and push it with the commands in the `docker_commands` output, then
    apply. Terraform stops with a readable message rather than leaving a task crash-looping.
  EOT
}

variable "migrate_image_tag" {
  type        = string
  default     = "migrate"
  description = <<-EOT
    Tag of the migration image — the same Dockerfile, `--target migrate`, which keeps the Prisma CLI
    and the seed that the slim runtime image drops.
  EOT
}

variable "log_retention_days" {
  type        = number
  default     = 7
  description = "CloudWatch Logs retention. architecture.md documents 7 days; the previous stack set 1."

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90], var.log_retention_days)
    error_message = "log_retention_days must be one of the CloudWatch retention values: 1, 3, 5, 7, 14, 30, 60, 90."
  }
}

########################################################################################################
# Database
########################################################################################################

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "Free tier for 12 months."
}

variable "db_allocated_storage" {
  type        = number
  default     = 20
  description = "GiB of gp3. 20 is the free-tier allowance."
}

variable "db_max_allocated_storage" {
  type        = number
  default     = 50
  description = <<-EOT
    Storage autoscaling ceiling. The previous stack set this equal to `allocated_storage`, which is
    a no-op rather than a cap (D-32). Above 20 GiB leaves the free tier, so the budget alarm is the
    backstop if the database ever actually grows.
  EOT
}

variable "db_username" {
  type        = string
  default     = "oneresi_admin"
  description = "Master username. The password is generated by RDS and never appears here (D-10)."
}

variable "allow_developer_db_access" {
  type        = bool
  default     = false
  description = <<-EOT
    Makes RDS publicly resolvable and opens 5432 to one address only — yours. This is how `db:pull`
    and `db:push` reach the instance from a laptop without a bastion, a NAT gateway or a VPC
    endpoint. Off by default; the instance is otherwise reachable only from inside the VPC.
  EOT
}

variable "developer_ip_cidr" {
  type        = string
  default     = ""
  description = <<-EOT
    Overrides the address discovered at plan time. Leave empty and Terraform asks
    checkip.amazonaws.com what your current public address is, so the rule cannot go stale in a
    tfvars file. Only read when `allow_developer_db_access` is true.
  EOT

  validation {
    condition     = var.developer_ip_cidr == "" || can(cidrnetmask(var.developer_ip_cidr))
    error_message = "developer_ip_cidr must be empty or a CIDR block such as 203.0.113.4/32."
  }
}

########################################################################################################
# Mail. The one real fork in this stack: a Route 53 domain, or individual verified addresses.
########################################################################################################

variable "ses_identity_mode" {
  type        = string
  default     = "emails"
  description = <<-EOT
    "domain" — you own a Route 53 hosted zone. Terraform creates the domain identity and writes the
    DKIM, MAIL FROM, SPF and DMARC records itself, and the sending identity verifies with nothing to
    click.
    "emails" — no domain. Terraform creates one identity per address in `ses_verified_emails` and AWS
    emails each mailbox a link that only its owner can click.
    Neither lifts the SES sandbox: sending *to* an unverified address needs production access, which
    is a separate request reviewed by a person.
  EOT

  validation {
    condition     = contains(["domain", "emails"], var.ses_identity_mode)
    error_message = "ses_identity_mode must be \"domain\" or \"emails\"."
  }
}

variable "ses_verified_emails" {
  type        = list(string)
  default     = []
  description = "Addresses to verify individually. Required when ses_identity_mode is \"emails\"; the first one becomes the default sender."

  validation {
    condition     = var.ses_identity_mode != "emails" || length(var.ses_verified_emails) > 0
    error_message = "ses_identity_mode = \"emails\" needs at least one address in ses_verified_emails — otherwise the application has nothing to send from."
  }

  validation {
    condition     = alltrue([for address in var.ses_verified_emails : can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[a-zA-Z]{2,}$", address))])
    error_message = "Every entry in ses_verified_emails must be a valid email address."
  }
}

variable "ses_domain" {
  type        = string
  default     = ""
  description = "Domain to verify, e.g. oneresi.in. Required when ses_identity_mode is \"domain\"."

  validation {
    condition     = var.ses_identity_mode != "domain" || var.ses_domain != ""
    error_message = "ses_identity_mode = \"domain\" needs ses_domain."
  }
}

variable "ses_mail_from_subdomain" {
  type        = string
  default     = "mail"
  description = "Custom MAIL FROM subdomain, so bounces come back to you rather than to amazonses.com. Domain mode only."
}

variable "mail_from_address" {
  type        = string
  default     = ""
  description = <<-EOT
    Sender address the application uses. Empty derives it: `no-reply@<ses_domain>` in domain mode,
    the first entry of `ses_verified_emails` otherwise.
  EOT
}

variable "route53_zone_name" {
  type        = string
  default     = ""
  description = <<-EOT
    Hosted zone to write records into, e.g. `oneresi.in`. Required for `ses_identity_mode = "domain"`
    and for `app_domain`. A zone costs $0.50 a month plus the registration; without one this stack
    still gets valid HTTPS from CloudFront's own certificate.
  EOT

  validation {
    condition     = var.ses_identity_mode != "domain" || var.route53_zone_name != ""
    error_message = "Domain mode writes DKIM records, which needs route53_zone_name."
  }
}

variable "app_domain" {
  type        = string
  default     = ""
  description = <<-EOT
    Hostname for the application, e.g. `app.oneresi.in`. Empty is the supported default: CloudFront
    serves its own `*.cloudfront.net` certificate, the browser sees valid TLS, the `Secure` session
    cookie is sent, and login works with no domain purchased (D-08). Set it and the same
    distribution takes an ACM certificate validated by a Route 53 record instead.
  EOT

  validation {
    condition     = var.app_domain == "" || var.route53_zone_name != ""
    error_message = "app_domain needs route53_zone_name so the certificate can be validated and the alias record written."
  }
}

########################################################################################################
# Lambda bundles and browser uploads
########################################################################################################

variable "notifier_bundle_dir" {
  type        = string
  default     = ""
  description = <<-EOT
    Directory to zip as the notifier Lambda. Empty uses the placeholder in `infra/lambda/notifier`,
    which fails loudly rather than acknowledging a message it cannot deliver. Point it at the built
    bundle from the monorepo — the real handler shares `packages/domain` and `packages/db` so the
    notification rules exist once.
  EOT
}

variable "overdue_bundle_dir" {
  type        = string
  default     = ""
  description = "Same, for the nightly overdue-flag Lambda. Empty uses `infra/lambda/overdue`."
}

variable "additional_cors_origins" {
  type        = list(string)
  default     = ["http://localhost:3000", "http://localhost:3001"]
  description = <<-EOT
    Extra origins allowed to issue the browser's presigned `PUT` against the uploads bucket. The
    CloudFront origin is added automatically; these are the local development servers, so an upload
    can be tested without deploying. The previous bucket had no CORS configuration at all, which the
    documented upload design requires.
  EOT
}

variable "github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = <<-EOT
    Reuse an existing GitHub OIDC provider instead of creating one. An account can only hold one
    provider for `token.actions.githubusercontent.com`, so if something else already created it,
    paste its ARN here and Terraform will attach the role to it rather than failing with
    EntityAlreadyExists.
  EOT
}
