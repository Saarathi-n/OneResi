# Complaint photos, announcement attachments and CSV exports. Private, encrypted, versioned — and,
# unlike the previous bucket, actually reachable by the application (see the task role in compute.tf)
# and by the browser's presigned PUT (the CORS rules below).

resource "aws_s3_bucket" "uploads" {
  bucket = "${local.name_prefix}-uploads-${local.account_id}"

  # Only ever true in dev, and only when asked for. A stray destroy elsewhere leaves the bucket and
  # its complaint photos standing.
  force_destroy = local.allow_destructive

  tags = { Name = "${local.name_prefix}-uploads" }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# The documented upload design is a presigned PUT straight from the browser, so bytes never pass
# through the application. That is a cross-origin request, and without these rules it fails in the
# browser with no useful error. The previous bucket had no CORS configuration at all.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    id              = "presigned-upload"
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = distinct(concat([local.app_url], var.additional_cors_origins))
    allowed_headers = ["content-type", "content-md5", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  # A CSV export is a snapshot of a report someone already looked at. Keeping them forever is
  # storage nobody reads.
  rule {
    id     = "expire-exports"
    status = "Enabled"

    filter {
      prefix = "${local.export_prefix}/"
    }

    expiration {
      days = 30
    }
  }

  # Versioning protects against an overwrite, not against paying for every version forever.
  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.uploads.arn,
          "${aws_s3_bucket.uploads.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.uploads]
}
