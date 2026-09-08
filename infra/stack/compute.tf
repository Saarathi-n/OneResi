# The application: cluster, roles, task definitions, the one-off migrate task, and the service.
#
# Four defects are closed here and each is called out where it happens: the task had no IAM identity
# of its own (D-11), it was given a plaintext connection string containing a committed password
# (D-10), it was never told which database to use or how to sign a session (D-05, D-06), and a
# crash-looping task counted as a successful deployment forever.

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  # Container Insights is not free and adds nothing at one task.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = { Name = local.name_prefix }
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

########################################################################################################
# Execution role — what ECS itself does on the task's behalf before any application code runs: pull the
# image, open the log stream, and resolve the two `secrets` entries. It is not the application's
# identity.
########################################################################################################

resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-execution"
  description        = "ECS agent: image pull, logs, secret resolution."
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "ResolveTaskSecrets"
    actions   = ["ssm:GetParameters"]
    resources = ["${local.ssm_arn_prefix}/*"]
  }

  statement {
    sid       = "ResolveTheDatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.main.master_user_secret[0].secret_arn]
  }

  statement {
    sid       = "DecryptThoseSecrets"
    actions   = ["kms:Decrypt"]
    resources = [local.db_secret_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "${local.name_prefix}-execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

########################################################################################################
# Task role — the application's own identity, which the previous task definition simply did not have.
# `task_role_arn` was unset, so every AWS call from inside the container failed with no credentials and
# the S3 bucket and SNS topic Terraform created were unreachable by design (D-11).
#
# Every statement below names the one bucket prefix, the one topic, the one verified identity or the
# one parameter subtree. Nothing here is `*` on a service.
########################################################################################################

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task"
  description        = "The application's identity: one bucket prefix, one topic, one mail identity, one parameter path."
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  # Presigned PUT and GET for complaint photos, attachments and CSV exports. Two prefixes, not the
  # whole bucket, and no s3:DeleteBucket-shaped surprises.
  statement {
    sid     = "ObjectsUnderTheTwoPrefixes"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [
      "${aws_s3_bucket.uploads.arn}/${local.upload_prefix}/*",
      "${aws_s3_bucket.uploads.arn}/${local.export_prefix}/*",
    ]
  }

  statement {
    sid       = "ListOnlyThosePrefixes"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.uploads.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.upload_prefix}/*", "${local.export_prefix}/*"]
    }
  }

  statement {
    sid       = "PublishDomainEvents"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.domain_events.arn]
  }

  statement {
    sid       = "SendMailAsTheVerifiedIdentity"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = concat(local.ses_identity_arns, [local.ses_configuration_set_arn])
  }

  # The other half of a send: reading back what SES said happened to it. `MailMessage.deliveryState`
  # comes from this queue, so whatever drains it needs to delete what it has read — otherwise the same
  # events are reprocessed until they expire.
  statement {
    sid = "ReadTheDeliveryEvents"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.mail_events.arn]
  }

  statement {
    sid       = "ReadOwnConfiguration"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["${local.ssm_arn_prefix}/*"]
  }

  statement {
    sid       = "ReadTheDatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.main.master_user_secret[0].secret_arn]
  }

  statement {
    sid       = "DecryptThoseSecrets"
    actions   = ["kms:Decrypt"]
    resources = [local.db_secret_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name_prefix}-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

########################################################################################################
# What the container is told.
#
# `DATABASE_URL` is deliberately not here. RDS owns the password and keeps it in Secrets Manager, so
# Terraform cannot compose a connection string without pulling the password into state — which is the
# defect being closed (D-10). Instead the credential arrives through `secrets`, resolved by the ECS
# agent at start-up, and the image's entrypoint assembles
# `postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require` in the container.
# Host, port, database and user are not credentials, so they travel as plain environment values.
#
# `DB_TARGET` and `JWT_SECRET` are the two the previous task definition omitted. Without the first the
# container would have written to an in-memory store and ignored the database provisioned for it
# (D-06); without the second it would have signed sessions with a constant committed to the repository
# (D-05).
########################################################################################################

locals {
  container_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "APP_PORT", value = "3001" },
    { name = "HOSTNAME", value = "0.0.0.0" },
    { name = "APP_ORIGIN", value = local.app_url },
    { name = "DB_TARGET", value = "cloud" },
    { name = "DB_HOST", value = aws_db_instance.main.address },
    { name = "DB_PORT", value = tostring(local.db_port) },
    { name = "DB_NAME", value = aws_db_instance.main.db_name },
    { name = "DB_USER", value = var.db_username },
    { name = "DB_SSLMODE", value = "require" },
    { name = "EMAIL_DRIVER", value = "ses" },
    { name = "STORAGE_DRIVER", value = "s3" },
    { name = "EVENT_DRIVER", value = "sns" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "S3_BUCKET", value = aws_s3_bucket.uploads.id },
    { name = "S3_UPLOAD_PREFIX", value = local.upload_prefix },
    { name = "S3_EXPORT_PREFIX", value = local.export_prefix },
    { name = "SNS_TOPIC_ARN", value = aws_sns_topic.domain_events.arn },
    { name = "SES_CONFIGURATION_SET", value = aws_sesv2_configuration_set.main.configuration_set_name },
    # `MAIL_FROM`, not `SES_FROM_ADDRESS`. `packages/mail/src/env.ts` reads this exact name and throws
    # MailConfigError when it is unset, so an earlier draft's `SES_FROM_ADDRESS` would have failed every
    # send in production with a message about a variable that nothing sets. One name, spelled the way
    # the code spells it.
    { name = "MAIL_FROM", value = local.mail_from_address },
    # Where SES delivery events land. `sesEventQueueUrl()` requires it, and the third tier of the mail
    # suite drains this queue to prove a message left AWS rather than merely being accepted.
    { name = "SES_EVENT_QUEUE_URL", value = aws_sqs_queue.mail_events.id },
    { name = "SSM_PREFIX", value = local.ssm_prefix },
  ]

  container_secrets = [
    { name = "JWT_SECRET", valueFrom = aws_ssm_parameter.jwt_secret.arn },
    # The `:password::` suffix selects one key out of the secret's JSON. The rest of it, including the
    # value itself, never leaves AWS.
    { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
  ]

  log_configuration = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.app.name
      "awslogs-region"        = var.aws_region
      "awslogs-stream-prefix" = "app"
    }
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name        = local.container_name
      image       = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential   = true
      stopTimeout = 30

      portMappings = [
        { containerPort = 3000, protocol = "tcp" },
      ]

      environment = local.container_environment
      secrets     = local.container_secrets

      # A container that answers this is running the application and can reach the database. A
      # container that does not is unhealthy, which is what lets the circuit breaker below notice.
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # tini as pid 1, so a SIGTERM during a redeploy reaches Node rather than being ignored.
      linuxParameters = {
        initProcessEnabled = true
      }

      logConfiguration = local.log_configuration
    },
  ])

  tags = { Name = "${local.name_prefix}-app" }
}

########################################################################################################
# Schema and seed, automatically.
#
# Without this you get a provisioned database with no tables in it, sitting in private subnets where a
# laptop cannot reach it, and a `deploy.ps1` that prints "Provisioning complete" anyway (D-19).
#
# A one-off task, the same image built with `--target migrate`, in the same subnets as the service, so
# RDS needs no public exposure for this path. It runs `prisma migrate deploy` and then the seed. The
# seed is convergent, so this is safe on every apply rather than only the first (D-45).
########################################################################################################

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name_prefix}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512" # migrations are short; paying for speed here costs fractions of a cent
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${aws_ecr_repository.app.repository_url}:${var.migrate_image_tag}"
      essential = true
      command   = ["node", "/build/bin/migrate.mjs"]

      environment = local.container_environment

      secrets = concat(local.container_secrets, [
        # So the deployed demo accounts do not share a password with every checkout of the repository.
        { name = "SEED_PASSWORD", valueFrom = aws_ssm_parameter.seed_password.arn },
      ])

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    },
  ])

  tags = { Name = "${local.name_prefix}-migrate" }
}

# Ordered after the instance is available and before the service scales up: the service below depends
# on this, and this depends on the instance. It re-runs whenever the migration image or the database
# changes, and fails the apply if the task exits non-zero — an empty database is not something to
# discover later.
resource "terraform_data" "migrate" {
  triggers_replace = {
    task_definition = aws_ecs_task_definition.migrate.arn
    database        = aws_db_instance.main.identifier
    image_tag       = var.migrate_image_tag
  }

  provisioner "local-exec" {
    command = "node \"${abspath(path.module)}/scripts/run-migrate.mjs\""

    environment = {
      AWS_REGION      = var.aws_region
      CLUSTER         = aws_ecs_cluster.main.name
      TASK_DEFINITION = aws_ecs_task_definition.migrate.arn
      CONTAINER_NAME  = "migrate"
      SUBNET_IDS      = join(",", aws_subnet.public[*].id)
      SECURITY_GROUPS = aws_security_group.app.id
      ECR_REPOSITORY  = aws_ecr_repository.app.name
      REPOSITORY_URL  = aws_ecr_repository.app.repository_url
      IMAGE_TAG       = var.migrate_image_tag
      APP_IMAGE_TAG   = var.image_tag
      LOG_GROUP       = aws_cloudwatch_log_group.app.name
      TIMEOUT_SECONDS = "900"
    }
  }

  depends_on = [
    aws_db_instance.main,
    aws_iam_role_policy.execution,
    aws_iam_role_policy.task,
    aws_vpc_security_group_ingress_rule.rds_from_app,
    aws_ssm_parameter.seed_password,
  ]
}

########################################################################################################
# The service
########################################################################################################

resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"
  desired_count   = var.desired_count

  # A task that never becomes healthy used to be a deployment that succeeded forever. This stops the
  # rollout, puts the previous task definition back, and fails the apply.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100
  health_check_grace_period_seconds  = 90
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  wait_for_steady_state              = true

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true # no NAT gateway; this is how the task reaches ECR, SES and S3
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.container_name
    container_port   = 3000
  }

  tags = { Name = "${local.name_prefix}-app" }

  # The database has tables in it before the first task starts, and the load balancer has somewhere to
  # send traffic before the service registers with it.
  depends_on = [
    terraform_data.migrate,
    aws_lb_listener_rule.from_cloudfront,
  ]
}

########################################################################################################
# The role GitHub Actions assumes. The workflows are another stream's; this is the part only Terraform
# can make, and it is what ADR 0001's "no long-lived AWS keys anywhere" actually requires.
########################################################################################################

resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]

  tags = { Name = "${local.name_prefix}-github-oidc" }
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type = "Federated"
      identifiers = [
        coalesce(
          var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : null,
          one(aws_iam_openid_connect_provider.github[*].arn),
        ),
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # One repository. Without this condition any GitHub Actions workflow anywhere could assume it.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name                 = "${local.name_prefix}-github-actions"
  description          = "Build, push, deploy and plan for ${var.github_repository} over OIDC."
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

# `terraform plan` has to read every resource in the stack, so the read half of this role is broad by
# necessity. What it must never be able to read is the two things that would let it impersonate a user.
resource "aws_iam_role_policy_attachment" "github_actions_read" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "github_actions" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # this action has no resource to scope to
  }

  statement {
    sid = "PushImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid = "DeployTheService"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:RunTask",
      "ecs:StopTask",
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
      "ecs:TagResource",
    ]
    resources = ["*"] # RegisterTaskDefinition and DescribeTaskDefinition take no resource
  }

  # RunTask and RegisterTaskDefinition hand these two roles to ECS. Without the condition this would
  # be a path to assuming any role in the account.
  statement {
    sid       = "HandTheTaskRolesToEcs"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid     = "TerraformState"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      "arn:${local.partition}:s3:::${var.project_name}-tfstate-${local.account_id}-${var.aws_region}",
      "arn:${local.partition}:s3:::${var.project_name}-tfstate-${local.account_id}-${var.aws_region}/*",
    ]
  }

  statement {
    sid       = "ReadDeploymentLogs"
    actions   = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.app.arn}:*"]
  }

  # The live mail tier of the suite sends a message and drains the delivery events to prove it left AWS.
  # `ReadOnlyAccess` above covers the receive; deleting what it has read is the part it does not, and a
  # suite that cannot delete reads the previous run's events on the next one.
  statement {
    sid       = "DrainTheMailEventsDuringTheLiveSuite"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.mail_events.arn]
  }

  # An explicit deny outranks every allow, including the read-only attachment above. CI can deploy the
  # application; it cannot read the key that signs sessions or the database password.
  statement {
    sid     = "NeverTheSigningKeyOrThePassword"
    effect  = "Deny"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "secretsmanager:GetSecretValue"]
    resources = [
      aws_ssm_parameter.jwt_secret.arn,
      aws_db_instance.main.master_user_secret[0].secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "github_actions" {
  name   = "${local.name_prefix}-github-actions"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions.json
}
