data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

# Only looked up when a domain is actually in play. Without one, nothing here needs Route 53.
data "aws_route53_zone" "primary" {
  count = local.needs_hosted_zone ? 1 : 0

  name         = var.route53_zone_name
  private_zone = false
}

locals {
  # Used by every nameable resource in this stack. The previous version prefixed with the project
  # name alone, so two environments collided on the RDS identifier, the security groups, the
  # cluster, the log group and the budget (D-49).
  name_prefix = "${var.project_name}-${var.environment}"

  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }

  # One switch for everything that can lose data on destroy, and it only opens in dev.
  allow_destructive = var.allow_destroy_with_data && var.environment == "dev"

  use_domain_identity = var.ses_identity_mode == "domain"
  use_custom_domain   = var.app_domain != ""
  needs_hosted_zone   = var.route53_zone_name != "" && (var.ses_identity_mode == "domain" || var.app_domain != "")

  mail_from_domain = local.use_domain_identity ? "${var.ses_mail_from_subdomain}.${var.ses_domain}" : ""
  mail_from_address = coalesce(
    var.mail_from_address != "" ? var.mail_from_address : null,
    local.use_domain_identity ? "no-reply@${var.ses_domain}" : null,
    try(var.ses_verified_emails[0], null),
    "no-reply@invalid",
  )

  # Where the browser's HTTPS origin actually is. CloudFront's own certificate unless a domain was
  # bought, which is what makes the `Secure` session cookie work with nothing purchased (D-08).
  app_url = local.use_custom_domain ? "https://${var.app_domain}" : "https://${aws_cloudfront_distribution.app.domain_name}"

  # SSM lives under /oneresi/<environment>/ and the task role is scoped to exactly that subtree.
  ssm_prefix     = "/${var.project_name}/${var.environment}"
  ssm_arn_prefix = "arn:${local.partition}:ssm:${var.aws_region}:${local.account_id}:parameter/${var.project_name}/${var.environment}"

  container_name = "app"
  db_port        = 5432

  upload_prefix = "uploads"
  export_prefix = "exports"

  # 10.0.1/2 public, 10.0.11/12 private — the shape the previous stack had, which was sound.
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]

  # SES permissions are scoped to the identity that was actually verified, not to ses:* on "*".
  ses_identity_arns = local.use_domain_identity ? [
    "arn:${local.partition}:ses:${var.aws_region}:${local.account_id}:identity/${var.ses_domain}",
    ] : [
    for address in var.ses_verified_emails :
    "arn:${local.partition}:ses:${var.aws_region}:${local.account_id}:identity/${address}"
  ]

  ses_configuration_set_arn = "arn:${local.partition}:ses:${var.aws_region}:${local.account_id}:configuration-set/${aws_sesv2_configuration_set.main.configuration_set_name}"

  # RDS reports the key that encrypts the managed secret as an ARN, but an IAM policy needs one either
  # way, so a bare key id is expanded rather than trusted to be already qualified.
  db_secret_kms_key_arn = startswith(aws_db_instance.main.master_user_secret[0].kms_key_id, "arn:") ? aws_db_instance.main.master_user_secret[0].kms_key_id : "arn:${local.partition}:kms:${var.aws_region}:${local.account_id}:key/${aws_db_instance.main.master_user_secret[0].kms_key_id}"

  developer_cidr = var.developer_ip_cidr != "" ? var.developer_ip_cidr : "${chomp(try(data.http.developer_ip[0].response_body, "0.0.0.0"))}/32"
}
