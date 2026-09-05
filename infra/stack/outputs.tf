output "app_url" {
  description = "The address to open. HTTPS, with a certificate that cost nothing."
  value       = local.app_url
}

output "cloudfront_domain" {
  description = "The distribution's own hostname, whether or not a custom domain is configured."
  value       = aws_cloudfront_distribution.app.domain_name
}

output "alb_dns_name" {
  description = "Load balancer hostname. Answers 403 to everything except CloudFront — that is deliberate, not a fault."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Where the two images go."
  value       = aws_ecr_repository.app.repository_url
}

output "docker_commands" {
  description = "Build and push both images. Run these from the repository root before the first apply, and after any application change."
  value       = <<-EOT
    aws ecr get-login-password --region ${var.aws_region} \
      | docker login --username AWS --password-stdin ${split("/", aws_ecr_repository.app.repository_url)[0]}

    docker build --file infra/docker/Dockerfile --target runtime \
      --tag ${aws_ecr_repository.app.repository_url}:${var.image_tag} .
    docker push ${aws_ecr_repository.app.repository_url}:${var.image_tag}

    docker build --file infra/docker/Dockerfile --target migrate \
      --tag ${aws_ecr_repository.app.repository_url}:${var.migrate_image_tag} .
    docker push ${aws_ecr_repository.app.repository_url}:${var.migrate_image_tag}
  EOT
}

output "database_endpoint" {
  description = "host:port. The password is not here and is not obtainable from Terraform — RDS keeps it in Secrets Manager."
  value       = aws_db_instance.main.endpoint
}

output "database_secret_arn" {
  description = "The RDS-managed secret holding the master credentials. The task and both Lambdas read it; nothing else may."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "uploads_bucket" {
  description = "Complaint photos, attachments and CSV exports."
  value       = aws_s3_bucket.uploads.id
}

output "domain_events_topic_arn" {
  description = "What the application publishes to after a transaction commits."
  value       = aws_sns_topic.domain_events.arn
}

output "notifications_queue_url" {
  description = "Feeds the notifier function."
  value       = aws_sqs_queue.notifications.id
}

output "notifications_dlq_url" {
  description = "Anything here failed three attempts. The alarm on its depth is the signal a notification was lost."
  value       = aws_sqs_queue.notifications_dlq.id
}

output "mail_events_queue_url" {
  description = "SES delivery events. `pnpm test:mail:live` drains this to prove a message left AWS."
  value       = aws_sqs_queue.mail_events.id
}

output "ses_configuration_set" {
  description = "Every SendEmail call must name this, or no events are published and the mail suite has nothing to read."
  value       = aws_sesv2_configuration_set.main.configuration_set_name
}

output "ses_from_address" {
  description = "The sender the application is permitted to use."
  value       = local.mail_from_address
}

output "ses_addresses_awaiting_a_click" {
  description = <<-EOT
    Identities AWS has emailed a verification link to. Nothing can click these for you: the link goes
    to the mailbox owner. Empty in domain mode, where the DNS records do it instead.
  EOT
  value       = [for identity in aws_sesv2_email_identity.addresses : identity.email_identity]
}

output "ses_sandbox_reminder" {
  description = "Read this before demonstrating mail."
  value       = "SES is in sandbox until you request production access, so mail is deliverable only to verified addresses. Sending works; the restriction is on the recipient."
}

output "github_actions_role_arn" {
  description = "Put this in the workflow's `role-to-assume`. There are no access keys to store."
  value       = aws_iam_role.github_actions.arn
}

output "ecs_cluster" {
  description = "Cluster name, for the scale commands below."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service" {
  description = "Service name, for the scale commands below."
  value       = aws_ecs_service.app.name
}

output "scale_commands" {
  description = "Fargate is the only meter that runs continuously. These two commands are the difference between ~$9 a month and pennies."
  value       = <<-EOT
    # stop — keeps everything, runs nothing
    aws ecs update-service --region ${var.aws_region} --cluster ${aws_ecs_cluster.main.name} \
      --service ${aws_ecs_service.app.name} --desired-count 0

    # start
    aws ecs update-service --region ${var.aws_region} --cluster ${aws_ecs_cluster.main.name} \
      --service ${aws_ecs_service.app.name} --desired-count ${var.desired_count == 0 ? 1 : var.desired_count}
  EOT
}

output "migrate_task_command" {
  description = "Re-run migrations and the seed by hand. Terraform does this on every apply; this is for when you want it without one."
  value       = <<-EOT
    aws ecs run-task --region ${var.aws_region} --cluster ${aws_ecs_cluster.main.name} \
      --task-definition ${aws_ecs_task_definition.migrate.family} --launch-type FARGATE \
      --network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.public[*].id)}],securityGroups=[${aws_security_group.app.id}],assignPublicIp=ENABLED}'
  EOT
}

output "seeded_password_command" {
  description = "The password every seeded account shares on this deployment. Generated, stored encrypted, and not printed by Terraform."
  value       = "aws ssm get-parameter --region ${var.aws_region} --name ${aws_ssm_parameter.seed_password.name} --with-decryption --query Parameter.Value --output text"
}

output "logs_command" {
  description = "Tail the application."
  value       = "aws logs tail ${aws_cloudwatch_log_group.app.name} --region ${var.aws_region} --follow"
}

output "manual_steps" {
  description = "Everything in this stack is automated except these. Each one is a human decision or a link AWS emails to a person."
  value = <<-EOT
    1. Confirm the AWS Budgets subscription for ${var.notification_email} (one email, one click).
    2. Confirm the two SNS subscriptions for ${var.notification_email} — alarms, and billing in us-east-1.
    3. ${local.use_domain_identity ?
  "Nothing for SES sending: the DKIM and MAIL FROM records are written for ${var.ses_domain}. Verification completes on its own within a few minutes." :
"Click the SES verification link in each of: ${join(", ", var.ses_verified_emails)}."}
    4. Optional, and the only item with a lead time: request SES production access if you want to mail
       addresses that are not verified. Free, reviewed by a person, usually a day.
  EOT
}
