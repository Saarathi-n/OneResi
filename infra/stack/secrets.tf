# Secrets, and the deliberate absence of one.
#
# Three values are generated here and none of them is a database password — RDS owns that one and
# keeps it in Secrets Manager where Terraform never sees it (see database.tf). What is generated here
# is the JWT signing key, the demo account password the seed uses, and the shared header CloudFront
# presents to the load balancer.
#
# Parameter Store SecureString is free; Secrets Manager bills $0.40 per secret per month, which is
# why architecture.md picks Parameter Store for everything it has a choice about.

resource "random_password" "jwt_secret" {
  length  = 64
  special = false # 64 base62 characters is 64 bytes, comfortably over the 32-byte floor
}

# The previous build fell back to a committed literal when this was unset, and the task definition
# never set it — so every deployed session was signed with a key that is in the repository and anyone
# could mint an administrator token (D-05). The application now refuses to boot without it.
resource "aws_ssm_parameter" "jwt_secret" {
  name        = "${local.ssm_prefix}/JWT_SECRET"
  description = "Session signing key for ${local.name_prefix}. Rotating it signs everyone out."
  type        = "SecureString"
  tier        = "Standard"
  value       = random_password.jwt_secret.result

  tags = { Name = "${local.name_prefix}-jwt-secret" }
}

# The seed reads SEED_PASSWORD and falls back to a literal in the repository. On AWS it gets a
# generated one instead, so the deployed demo accounts do not share a password with every checkout.
# `terraform output seeded_password_command` prints how to read it back.
resource "random_password" "seed_password" {
  length  = 20
  special = false # typed by hand at a demo, so no shell-quoting surprises
}

resource "aws_ssm_parameter" "seed_password" {
  name        = "${local.ssm_prefix}/SEED_PASSWORD"
  description = "Password the migrate task gives every seeded account."
  type        = "SecureString"
  tier        = "Standard"
  value       = random_password.seed_password.result

  tags = { Name = "${local.name_prefix}-seed-password" }
}

# CloudFront sends this on every origin request and the load balancer's only forwarding rule requires
# it. Not a credential — the security group already restricts the origin to CloudFront's ranges —
# but it stops a second distribution someone else owns from using this ALB as its origin.
resource "random_password" "origin_verify" {
  length  = 40
  special = false
}
