# RDS for PostgreSQL 16, single AZ, free tier. The instance itself is nearly what the previous stack
# had; what it did not have was backups, encryption, forced TLS, a managed password, or a version
# that survives a patch deprecation (D-32, D-10).

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db"
  description = "Private subnets for ${local.name_prefix}"
  subnet_ids  = aws_subnet.private[*].id

  tags = { Name = "${local.name_prefix}-db" }
}

# `rds.force_ssl = 1` refuses any connection that is not TLS. The application's connection string
# carries `sslmode=require` to match, and packages/db refuses to start a cloud target without it.
resource "aws_db_parameter_group" "main" {
  # A prefix rather than a fixed name, so a change of family can be created before the old group is
  # destroyed. A fixed name cannot: the instance still holds the old one when the new one is made.
  name_prefix = "${local.name_prefix}-pg16-"
  family      = "postgres16"
  description = "Forces TLS and logs slow statements for ${local.name_prefix}"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  # db.t4g.micro derives a default of ~19 total slots, five of which are reserved for rds_reserved
  # — about 14 usable. The app task runs two Next servers (web + PWA), each with its own Prisma
  # pool (connection_limit=5 in the entrypoint), and every warm notifier execution environment
  # holds another pool (connection_limit=2 where its URL is built). Fourteen is not enough for
  # that arithmetic, and when it runs out even the health check's SELECT 1 is refused. 80 is far
  # beyond what this shape of deployment can open; memory per connection on a micro is the real
  # ceiling, and at these pool sizes it stays well inside.
  parameter {
    name         = "max_connections"
    value        = "80"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "log_min_duration_statement"
    value        = "2000"
    apply_method = "immediate"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "PostgreSQL. The application, the two Lambdas, and optionally one developer address."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-rds" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_app" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Application tasks, including the one-off migrate task"
  ip_protocol                  = "tcp"
  from_port                    = local.db_port
  to_port                      = local.db_port
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_lambda" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Notifier and overdue-flag functions"
  ip_protocol                  = "tcp"
  from_port                    = local.db_port
  to_port                      = local.db_port
  referenced_security_group_id = aws_security_group.lambda.id
}

########################################################################################################
# The developer path. `db:pull` and `db:push` need to reach RDS from a laptop, and there is no
# bastion, no NAT gateway and no VPC endpoint to reach it through. One security group rule holding
# one address is the cheapest honest answer, and it is off unless asked for.
#
# Two things switch on together, and the path needs both: this rule, and the default IPv4 route in
# network.tf that lets the instance's reply leave the subnet.
########################################################################################################

data "http" "developer_ip" {
  count = var.allow_developer_db_access && var.developer_ip_cidr == "" ? 1 : 0

  url = "https://checkip.amazonaws.com"

  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "Could not discover this machine's public address. Set developer_ip_cidr instead."
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_developer" {
  count = var.allow_developer_db_access ? 1 : 0

  security_group_id = aws_security_group.rds.id
  description       = "One developer address, discovered at plan time"
  ip_protocol       = "tcp"
  from_port         = local.db_port
  to_port           = local.db_port
  cidr_ipv4         = local.developer_cidr
}

########################################################################################################
# The instance
########################################################################################################

resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  instance_class = var.db_instance_class

  # Major version only. Pinning a patch release — the previous stack pinned 16.3 — means `apply`
  # breaks the month AWS deprecates it. Minor upgrades happen in the maintenance window instead.
  engine_version              = "16"
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  apply_immediately           = local.allow_destructive

  db_name               = "grihaone"
  username              = var.db_username
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  # RDS generates the password, puts it in Secrets Manager and rotates it. The value never appears in
  # a variable, in this file, in an environment variable, or in Terraform state (D-10). Nothing here
  # can print it; `secrets` on the task definition is how the container gets it.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  publicly_accessible = var.allow_developer_db_access
  multi_az            = false
  network_type        = "IPV4"

  # architecture.md says recovery is a restore from an automated snapshot. Unset means zero, which
  # means there are none.
  # One day: the account's free plan caps retention (FreeTierRestrictionError at 7), and a
  # demo database needs yesterday, not a week.
  backup_retention_period = 1
  backup_window           = "18:00-18:30" # 23:30 IST, before the 00:30 IST overdue job
  maintenance_window      = "sun:19:00-sun:20:00"
  copy_tags_to_snapshot   = true

  skip_final_snapshot       = local.allow_destructive
  final_snapshot_identifier = local.allow_destructive ? null : "${local.name_prefix}-final-${formatdate("YYYYMMDDhhmm", plantimestamp())}"
  deletion_protection       = !local.allow_destructive

  performance_insights_enabled = false
  monitoring_interval          = 0

  tags = { Name = "${local.name_prefix}-postgres" }

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}
