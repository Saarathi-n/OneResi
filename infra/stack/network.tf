# One VPC, two public subnets, two private subnets, no NAT gateway — the shape architecture.md
# describes and the previous stack got mostly right. What changes: the private subnets get their own
# route table so they are private by design rather than by omission, every name carries
# `local.name_prefix`, and IPv6 egress exists.

resource "aws_vpc" "main" {
  cidr_block                       = "10.0.0.0/16"
  enable_dns_hostnames             = true
  enable_dns_support               = true
  assign_generated_ipv6_cidr_block = true

  tags = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-igw" }
}

# The private subnets have no IPv4 route out, and a NAT gateway is ~$41 a month with no free tier,
# which architecture.md rules out explicitly. An egress-only internet gateway is the IPv6 equivalent
# and is free. It is what gives the two Lambdas inside the VPC a way to reach Secrets Manager, SES
# and CloudWatch at all — they call the dual-stack `*.api.aws` endpoints. See the note in events.tf.
resource "aws_egress_only_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-eigw" }
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                          = aws_vpc.main.id
  cidr_block                      = local.public_subnet_cidrs[count.index]
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.main.ipv6_cidr_block, 8, count.index)
  availability_zone               = local.azs[count.index]
  map_public_ip_on_launch         = true
  assign_ipv6_address_on_creation = true

  tags = { Name = "${local.name_prefix}-public-${count.index + 1}" }
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id                          = aws_vpc.main.id
  cidr_block                      = local.private_subnet_cidrs[count.index]
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.main.ipv6_cidr_block, 8, count.index + 10)
  availability_zone               = local.azs[count.index]
  assign_ipv6_address_on_creation = true

  tags = { Name = "${local.name_prefix}-private-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  route {
    ipv6_cidr_block = "::/0"
    gateway_id      = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name_prefix}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# No IPv4 route to anywhere outside the VPC. RDS lives here and nothing in here can be reached from
# the internet, which is the property the previous stack got by leaving these subnets with no route
# table of their own rather than by saying so.
#
# Its routes are separate resources rather than inline blocks, because one of them is conditional and
# the provider does not allow a table with inline routes to coexist with an `aws_route` — the two
# overwrite each other on alternate applies.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-private-rt" }
}

# Free, and the only way out of these subnets: it is how the two Lambdas reach Secrets Manager, SES and
# CloudWatch at all. See the note at the top of events.tf.
resource "aws_route" "private_egress_ipv6" {
  route_table_id              = aws_route_table.private.id
  destination_ipv6_cidr_block = "::/0"
  egress_only_gateway_id      = aws_egress_only_internet_gateway.main.id
}

# `publicly_accessible` on the instance is necessary for the developer path and not sufficient: RDS
# gives the instance a public address, but a public address in a subnet with no default route is
# unreachable — the SYN arrives through the internet gateway and the reply has nowhere to go. So the
# security group rule in database.tf needs this alongside it, and both appear and disappear together.
#
# Switching it on exposes nothing else. The instance's own group admits one address, functions attached
# to a VPC never receive a public address, and nothing else lives in these subnets.
resource "aws_route" "private_developer_ipv4" {
  count = var.allow_developer_db_access ? 1 : 0

  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "private" {
  count = 2

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Gateway endpoints are free, unlike the interface kind at ~$7 a month each. This one keeps S3
# traffic — complaint photos, attachments, CSV exports — inside the VPC and off the IGW path.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id, aws_route_table.private.id]

  tags = { Name = "${local.name_prefix}-s3-endpoint" }
}

########################################################################################################
# Security groups. Three of them, each with one job.
########################################################################################################

# AWS publishes the list of addresses CloudFront makes origin requests from, and keeps it current.
data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Load balancer. Reachable from CloudFront origin-facing ranges only."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-alb" }
}

# Port 80 on the load balancer is plain HTTP, which is exactly what a `Secure` cookie will not
# travel over — so the internet is not allowed to talk to it at all. Only CloudFront is, and
# CloudFront only speaks HTTPS to the browser. This prefix list is around 55 entries and each counts
# as a rule against the group's 60-rule quota, which is why it is the only rule here.
resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  count = var.enable_cloudfront ? 1 : 0

  security_group_id = aws_security_group.alb.id
  description       = "HTTP from CloudFront edge locations"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
}

# The same port without the CDN in front: the load balancer is the public edge, so it answers
# the internet directly. One of the two rules exists, never both.
resource "aws_vpc_security_group_ingress_rule" "alb_from_internet" {
  count = var.enable_cloudfront ? 0 : 1

  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the internet - no CDN in front (enable_cloudfront is false)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the application container"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app"
  description = "Fargate tasks. Ingress from the load balancer only."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-app" }
}

# What architecture.md has always claimed and the previous stack did not do: the task's group
# accepted 0.0.0.0/0 on 3000 and the task had a public IP, so the application was on the open
# internet in cleartext (D-08).
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "Next.js port, load balancer only"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  referenced_security_group_id = aws_security_group.alb.id
}

# The task still needs to get out: ECR, Secrets Manager, SSM, S3, SNS, SES. It sits in a public
# subnet with a public IP precisely so that costs nothing.
resource "aws_vpc_security_group_egress_rule" "app_egress_ipv4" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound to AWS APIs"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "app_egress_ipv6" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound to AWS APIs over IPv6"
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
}

resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda"
  description = "Notifier and overdue-flag functions. No ingress; reaches RDS and, over IPv6, AWS APIs."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-lambda" }
}

resource "aws_vpc_security_group_egress_rule" "lambda_egress_ipv4" {
  security_group_id = aws_security_group.lambda.id
  description       = "PostgreSQL and anything else inside the VPC"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "lambda_egress_ipv6" {
  security_group_id = aws_security_group.lambda.id
  description       = "AWS APIs through the egress-only gateway"
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
}
