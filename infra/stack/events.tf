# Events and scheduled work. Documented in architecture.md, absent from the previous Terraform in
# full: no topic subscription, no queue, no dead letter queue, no Lambda, no schedule (D-35), and the
# overdue job was an unauthenticated HTTP endpoint that nothing called (D-36).
#
# ── A note on how these two functions reach AWS ──────────────────────────────────────────────────
# Both are attached to the private subnets, because both write to RDS. Those subnets have no IPv4
# route out — that is the point of having no NAT gateway — so the functions reach Secrets Manager, SES
# and CloudWatch over IPv6 through the egress-only gateway in network.tf, with
# AWS_USE_DUALSTACK_ENDPOINT set so the SDK resolves the `*.api.aws` endpoints. This is free. The two
# alternatives are a NAT gateway at ~$41 a month and an interface endpoint per service at ~$7, both of
# which architecture.md rules out on cost. If a dual-stack endpoint ever turns out to be unavailable
# in this region, one `aws_vpc_endpoint` of type Interface for that service is the fix, and the DLQ
# alarm is what tells you.

resource "aws_sns_topic" "domain_events" {
  name = "${local.name_prefix}-domain-events"

  tags = { Name = "${local.name_prefix}-domain-events" }
}

resource "aws_sqs_queue" "notifications" {
  name = "${local.name_prefix}-notifications"

  # Six times the function timeout, so a retry cannot begin while the first attempt is still running.
  visibility_timeout_seconds = 180
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notifications_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "${local.name_prefix}-notifications" }
}

# Three failed attempts and the message stops circulating and starts being visible instead. The alarm
# on this queue's depth is in observability.tf.
resource "aws_sqs_queue" "notifications_dlq" {
  name                      = "${local.name_prefix}-notifications-dlq"
  message_retention_seconds = 1209600 # the maximum, 14 days
  sqs_managed_sse_enabled   = true

  tags = { Name = "${local.name_prefix}-notifications-dlq" }
}

resource "aws_sqs_queue_redrive_allow_policy" "notifications_dlq" {
  queue_url = aws_sqs_queue.notifications_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.notifications.arn]
  })
}

resource "aws_sns_topic_subscription" "notifications" {
  topic_arn            = aws_sns_topic.domain_events.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.notifications.arn
  raw_message_delivery = true
}

resource "aws_sqs_queue_policy" "notifications" {
  queue_url = aws_sqs_queue.notifications.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSnsDelivery"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.notifications.arn
        Condition = {
          ArnEquals = { "aws:SourceArn" = aws_sns_topic.domain_events.arn }
        }
      },
    ]
  })
}

########################################################################################################
# Bundles. The placeholders in infra/lambda refuse to acknowledge a message they cannot deliver, so
# nothing is silently dropped before the real handlers exist. Point the two variables at the built
# bundles from the monorepo and Terraform deploys those instead.
########################################################################################################

data "archive_file" "notifier" {
  type        = "zip"
  source_dir  = var.notifier_bundle_dir != "" ? var.notifier_bundle_dir : "${path.module}/../lambda/notifier"
  output_path = "${path.module}/.terraform/bundles/notifier.zip"
}

data "archive_file" "overdue" {
  type        = "zip"
  source_dir  = var.overdue_bundle_dir != "" ? var.overdue_bundle_dir : "${path.module}/../lambda/overdue"
  output_path = "${path.module}/.terraform/bundles/overdue.zip"
}

locals {
  # Everything both functions need to open a database connection and send mail. The password is not
  # here — they read it from Secrets Manager with the role below, exactly as the task does.
  lambda_environment = {
    NODE_ENV                   = "production"
    DB_TARGET                  = "cloud"
    DB_HOST                    = aws_db_instance.main.address
    DB_PORT                    = tostring(local.db_port)
    DB_NAME                    = aws_db_instance.main.db_name
    DB_USER                    = var.db_username
    DB_SECRET_ARN              = aws_db_instance.main.master_user_secret[0].secret_arn
    APP_ORIGIN                 = local.app_url
    EMAIL_DRIVER               = "ses"
    SES_CONFIGURATION_SET      = aws_sesv2_configuration_set.main.configuration_set_name
    SES_FROM_ADDRESS           = local.mail_from_address
    AWS_USE_DUALSTACK_ENDPOINT = "true"
    NODE_OPTIONS               = "--enable-source-maps"
  }
}

########################################################################################################
# Notifier: SNS to SQS to here. Sends the mail and writes the in-app notification rows, so a handler
# that changed something can return without waiting on SES (UC-29 alternative flow 3a).
########################################################################################################

resource "aws_lambda_function" "notifier" {
  function_name = "${local.name_prefix}-notifier"
  role          = aws_iam_role.notifier.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 30

  filename         = data.archive_file.notifier.output_path
  source_code_hash = data.archive_file.notifier.output_base64sha256

  vpc_config {
    subnet_ids                  = aws_subnet.private[*].id
    security_group_ids          = [aws_security_group.lambda.id]
    ipv6_allowed_for_dual_stack = true
  }

  environment {
    variables = merge(local.lambda_environment, {
      NOTIFICATIONS_QUEUE_URL = aws_sqs_queue.notifications.id
    })
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.notifier.name
  }

  tags = { Name = "${local.name_prefix}-notifier" }

  depends_on = [aws_cloudwatch_log_group.notifier]
}

resource "aws_lambda_event_source_mapping" "notifications" {
  event_source_arn = aws_sqs_queue.notifications.arn
  function_name    = aws_lambda_function.notifier.arn

  batch_size                         = 10
  maximum_batching_window_in_seconds = 5

  # One bad message in a batch of ten does not take the other nine back to the queue.
  function_response_types = ["ReportBatchItemFailures"]
}

########################################################################################################
# Overdue flag: one scheduled job, 00:30 in the society's own timezone. Replaces POST
# /api/cron/overdue, which had no session check, no shared secret and no caller (D-36).
########################################################################################################

resource "aws_lambda_function" "overdue" {
  function_name = "${local.name_prefix}-overdue-flag"
  role          = aws_iam_role.overdue.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 60

  filename         = data.archive_file.overdue.output_path
  source_code_hash = data.archive_file.overdue.output_base64sha256

  vpc_config {
    subnet_ids                  = aws_subnet.private[*].id
    security_group_ids          = [aws_security_group.lambda.id]
    ipv6_allowed_for_dual_stack = true
  }

  environment {
    variables = merge(local.lambda_environment, {
      SOCIETY_TIMEZONE = "Asia/Kolkata"
    })
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.overdue.name
  }

  tags = { Name = "${local.name_prefix}-overdue-flag" }

  depends_on = [aws_cloudwatch_log_group.overdue]
}

# EventBridge Scheduler rather than a rule, because it takes a timezone directly and does not need a
# UTC offset that breaks twice a year in places that observe daylight saving.
resource "aws_scheduler_schedule" "overdue" {
  name        = "${local.name_prefix}-overdue-flag"
  description = "Marks unpaid invoices overdue once their due date is strictly past, in IST."
  group_name  = "default"

  schedule_expression          = "cron(30 0 * * ? *)"
  schedule_expression_timezone = "Asia/Kolkata"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.overdue.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ source = "schedule", job = "overdue-flag" })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}

########################################################################################################
# Roles. One per function, so the notifier's ability to send mail is not also granted to the nightly
# job that only touches invoices.
########################################################################################################

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "notifier" {
  name               = "${local.name_prefix}-notifier"
  description        = "Drains the notification queue, sends mail, writes notification rows."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Managed policies here rather than hand-written ones: the ENI lifecycle permissions a VPC function
# needs are AWS's business, not something to guess at.
resource "aws_iam_role_policy_attachment" "notifier_vpc" {
  role       = aws_iam_role.notifier.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "notifier" {
  statement {
    sid = "DrainTheQueue"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.notifications.arn]
  }

  statement {
    sid       = "SendMailAsTheVerifiedIdentity"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = concat(local.ses_identity_arns, [local.ses_configuration_set_arn])
  }

  statement {
    sid       = "ReadTheDatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.main.master_user_secret[0].secret_arn]
  }

  statement {
    sid       = "DecryptThatSecret"
    actions   = ["kms:Decrypt"]
    resources = [local.db_secret_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "notifier" {
  name   = "${local.name_prefix}-notifier"
  role   = aws_iam_role.notifier.id
  policy = data.aws_iam_policy_document.notifier.json
}

resource "aws_iam_role" "overdue" {
  name               = "${local.name_prefix}-overdue-flag"
  description        = "Nightly overdue invoice flag. Database only."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "overdue_vpc" {
  role       = aws_iam_role.overdue.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "overdue" {
  statement {
    sid       = "ReadTheDatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.main.master_user_secret[0].secret_arn]
  }

  statement {
    sid       = "DecryptThatSecret"
    actions   = ["kms:Decrypt"]
    resources = [local.db_secret_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "overdue" {
  name   = "${local.name_prefix}-overdue-flag"
  role   = aws_iam_role.overdue.id
  policy = data.aws_iam_policy_document.overdue.json
}

resource "aws_iam_role" "scheduler" {
  name        = "${local.name_prefix}-scheduler"
  description = "Lets EventBridge Scheduler invoke the overdue-flag function and nothing else."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRole"
        Principal = { Service = "scheduler.amazonaws.com" }
        Condition = {
          StringEquals = { "aws:SourceAccount" = local.account_id }
        }
      },
    ]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${local.name_prefix}-scheduler"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = [aws_lambda_function.overdue.arn, "${aws_lambda_function.overdue.arn}:*"]
      },
    ]
  })
}
