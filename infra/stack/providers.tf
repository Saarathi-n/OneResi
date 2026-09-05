provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

# CloudFront reads its certificate from us-east-1 and nowhere else, and the AWS/Billing metric
# namespace only exists there. Both are the only reasons this alias exists; everything the
# application runs on is in ap-south-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.tags
  }
}
