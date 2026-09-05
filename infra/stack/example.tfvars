########################################################################################################
# Copy to terraform.tfvars and fill in. `terraform.tfvars` is gitignored; this file is not.
#
#   cp example.tfvars terraform.tfvars
#
# Two values have no default and Terraform will not plan without them. Everything else here is
# optional and shown with the default it already has.
########################################################################################################

# REQUIRED — a mailbox you can actually open, because you have to click a link in it.
# This is where the $5 budget alarm at 80% actual, the forecast alarm at 100%, and every CloudWatch
# alarm arrive. The previous stack defaulted this to ashvin@example.com, which meant the only
# guardrail against runaway cost pointed at nothing.
notification_email = "you@gmail.com"

# REQUIRED — owner/repo, for the trust policy on the IAM role GitHub Actions assumes over OIDC.
# The workflows are not part of this stack; the role they assume has to be, because only Terraform
# can create it. Set it even if CI does not exist yet — an unused role costs nothing.
github_repository = "Ashvin-KS/OneResi"

########################################################################################################
# Naming. Both halves appear in every resource name, so two environments can coexist.
########################################################################################################

# aws_region  = "ap-south-1"   # Mumbai. Your AWS CLI default must match, or SES verifies an identity
#                              # in the wrong region and the deployment cannot send from it.
# project_name = "oneresi"
# environment  = "dev"         # "dev" is also the only value that lets allow_destroy_with_data work.

########################################################################################################
# Cost
########################################################################################################

# budget_limit_usd = "5"       # Monthly ceiling. Also the CloudWatch billing alarm's threshold.
# desired_count    = 1         # Running tasks. 0 stops the only continuous meter without deleting
#                              # anything; `terraform output scale_commands` prints the two CLI calls.

# Lets `terraform destroy` take the database, the images and the uploads bucket with it, and skips the
# final snapshot. Ignored unless environment is exactly "dev". Turn it on for a stack you tear down
# between sessions; leave it off for anything holding real complaint photos.
allow_destroy_with_data = true

########################################################################################################
# Mail. The one real fork in this stack.
########################################################################################################

# Without a domain: verify each mailbox you want to send from or to. AWS emails each address a link
# that only its owner can click, which is why this is on the manual list. Use real inboxes you control
# — the seeded accounts' @oneresi.in addresses are not deliverable.
ses_identity_mode   = "emails"
ses_verified_emails = ["you@gmail.com", "someone.else@gmail.com"]

# With a Route 53 domain (~₹1,000/yr plus $0.50/month for the zone): Terraform creates the domain
# identity and writes the DKIM, MAIL FROM, SPF and DMARC records itself, and the sending identity
# verifies with nothing to click. Swap the three lines above for these four.
#
# ses_identity_mode       = "domain"
# ses_domain              = "oneresi.in"
# route53_zone_name       = "oneresi.in"
# ses_mail_from_subdomain = "mail"          # bounces come back to mail.oneresi.in rather than to AWS

# Sender address. Empty derives it: no-reply@<ses_domain> in domain mode, otherwise the first entry of
# ses_verified_emails.
# mail_from_address = ""

# Neither mode lifts the SES sandbox. Sending only to verified addresses is a sandbox restriction, and
# production access is a separate free request that a person reviews — file it early if you want it.

########################################################################################################
# A custom hostname, if you bought one. Leave this alone and CloudFront serves its own
# *.cloudfront.net certificate: valid TLS, the Secure session cookie works, nothing purchased.
########################################################################################################

# app_domain        = "app.oneresi.in"   # needs route53_zone_name; ACM validates it automatically
# route53_zone_name = "oneresi.in"

########################################################################################################
# The image. Build and push before the first apply — `terraform output docker_commands` prints the
# exact four commands. The apply stops with a readable message if the tag is not in ECR yet, rather
# than leaving a task crash-looping.
########################################################################################################

# image_tag         = "latest"    # the application; use a commit sha in CI
# migrate_image_tag = "migrate"   # same Dockerfile, --target migrate: keeps the Prisma CLI and the seed
# task_cpu          = 256         # 0.25 vCPU
# task_memory       = 512

########################################################################################################
# Database
########################################################################################################

# db_instance_class        = "db.t4g.micro"   # free tier for twelve months
# db_allocated_storage     = 20               # GiB, the free-tier allowance
# db_max_allocated_storage = 50               # a real autoscaling ceiling, not the no-op the last one was
# db_username              = "oneresi_admin"  # the password is generated by RDS and never appears here

# Opens 5432 to exactly one address — yours, discovered at plan time — and makes the instance
# resolvable. This is how `db:pull` and `db:push` reach RDS from a laptop with no bastion and no NAT
# gateway. Turn it off when you are done.
# allow_developer_db_access = false
# developer_ip_cidr         = ""    # override the discovered address, e.g. "203.0.113.4/32"

########################################################################################################
# Odds and ends
########################################################################################################

# log_retention_days = 7    # what architecture.md documents

# Origins allowed to issue the browser's presigned PUT against the uploads bucket. The deployed origin
# is added automatically; these are the local dev servers so an upload can be tested before deploying.
# additional_cors_origins = ["http://localhost:3000", "http://localhost:3001"]

# Point these at the built Lambda bundles from the monorepo once they exist. Empty uses the
# placeholders in infra/lambda, which fail loudly rather than acknowledging a message they cannot
# deliver.
# notifier_bundle_dir = ""
# overdue_bundle_dir  = ""

# An account can hold only one GitHub OIDC provider. If something else already created it, paste its
# ARN here instead of having Terraform fail with EntityAlreadyExists.
# github_oidc_provider_arn = ""
