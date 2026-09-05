# The Terraform state bucket, and nothing else.
#
# Applied once, ever, with local state — the chicken-and-egg at the bottom of every remote backend.
# Everything else is in ../stack, which keeps its state in the bucket this creates. Read README.md
# before running it.
#
# The previous attempt had no backend block at all, so state was a file on one laptop and losing it
# meant losing the ability to destroy the stack (D-33).

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      Component = "tfstate"
      ManagedBy = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Bucket names are global. Account id and region make this deterministic rather than random, so
  # the backend block in ../stack/versions.tf can be written by hand and never looked up.
  bucket_name = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name

  # Losing this bucket loses the ability to destroy the stack it tracks, which on a student account
  # is a runaway-cost event. Delete this block deliberately if you ever mean to remove the bucket.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is not decoration here: with `use_lockfile = true` the lock and the state live in the
# same bucket, and a corrupt apply is recoverable only if the previous version is still there.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# State files are small and rewritten on every apply. Keeping every version forever is pointless;
# keeping a month of them is what makes a bad apply recoverable.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.state.arn,
          "${aws_s3_bucket.state.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.state]
}
