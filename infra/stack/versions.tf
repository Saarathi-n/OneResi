# Terraform and provider versions, and the remote backend.
#
# 1.10 is a hard floor: `use_lockfile` is the S3 backend's native state locking and it does not exist
# before that release, which is why there is no DynamoDB table here (D-33).
#
# Nothing needs installing to satisfy that floor. 1.15.8 is already on this machine; a stale 1.9.8 in
# `~/bin` comes first on PATH and shadows it, so a bare `terraform` fails with "Unsupported Terraform
# Core version" while the installed binary is fine (D-79). Rename that copy, or put the winget package
# directory earlier on PATH, or call the newer binary by its full path.

terraform {
  required_version = ">= 1.10.0"

  # A backend block cannot interpolate variables, so the bucket name is literal. It is the
  # deterministic name `infra/bootstrap` produces — `<project>-tfstate-<account>-<region>` — and the
  # bootstrap stack prints this exact block as an output so the two can be compared.
  #
  # A second environment does not need a second bucket or a second key written here: use a
  # workspace. `terraform workspace new staging` stores state under `env:/staging/...` on its own,
  # and `local.name_prefix` keeps the AWS resource names apart (D-49).
  backend "s3" {
    bucket       = "grihaone-tfstate-215671569291-ap-south-1"
    key          = "stack/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
    # random: the JWT signing secret and the CloudFront-to-ALB shared header. Never a password —
    # RDS generates that one itself so it stays out of state entirely (D-10).
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
    # archive: zips the two Lambda bundles.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    # http: discovers your current public address for the optional developer database rule, so the
    # CIDR is not a stale literal in a tfvars file.
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
  }
}
