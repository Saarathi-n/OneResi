# SES, the configuration set, and the event pipeline the mail test suite reads.
#
# None of this existed before: `SESEmailProvider.sendEmail` wrote a console line and appended to a
# JSON file on the container's disk, and there was no SES resource in Terraform at all (D-30, D-35).
#
# SES stays in **sandbox** until you ask AWS otherwise, which means you can send only to verified
# addresses. That is already recorded as a limitation in architecture.md. Everything else — signing,
# suppression, events — works identically in sandbox.

# A bounce that keeps being retried is how an account loses its sending reputation. Suppression is
# account-wide and free.
resource "aws_sesv2_account_suppression_attributes" "main" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}

resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = "${local.name_prefix}-mail"

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

########################################################################################################
# Identities. Either one domain, verified with nothing to click, or one per address with a link only
# its owner can follow.
########################################################################################################

resource "aws_sesv2_email_identity" "domain" {
  count = local.use_domain_identity ? 1 : 0

  email_identity         = var.ses_domain
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = { Name = "${local.name_prefix}-identity" }
}

resource "aws_sesv2_email_identity" "addresses" {
  for_each = local.use_domain_identity ? toset([]) : toset(var.ses_verified_emails)

  email_identity         = each.value
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name

  tags = { Name = "${local.name_prefix}-identity" }
}

########################################################################################################
# DNS, in domain mode. Terraform writes every record from the identity's own outputs, so verification
# completes on its own and there is nothing to copy out of a console.
########################################################################################################

resource "aws_route53_record" "dkim" {
  count = local.use_domain_identity ? 3 : 0

  zone_id         = data.aws_route53_zone.primary[0].zone_id
  name            = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.ses_domain}"
  type            = "CNAME"
  ttl             = 600
  records         = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
  allow_overwrite = true
}

# Without a custom MAIL FROM, bounces are addressed to amazonses.com and the envelope sender does not
# match the visible one, which some receivers treat as a signal.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count = local.use_domain_identity ? 1 : 0

  email_identity         = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  count = local.use_domain_identity ? 1 : 0

  zone_id         = data.aws_route53_zone.primary[0].zone_id
  name            = local.mail_from_domain
  type            = "MX"
  ttl             = 600
  records         = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
  allow_overwrite = true
}

resource "aws_route53_record" "mail_from_spf" {
  count = local.use_domain_identity ? 1 : 0

  zone_id         = data.aws_route53_zone.primary[0].zone_id
  name            = local.mail_from_domain
  type            = "TXT"
  ttl             = 600
  records         = ["v=spf1 include:amazonses.com ~all"]
  allow_overwrite = true
}

# Monitoring only. Nothing is rejected at p=none, which is the right setting for a domain that has
# just started sending.
resource "aws_route53_record" "dmarc" {
  count = local.use_domain_identity ? 1 : 0

  zone_id         = data.aws_route53_zone.primary[0].zone_id
  name            = "_dmarc.${var.ses_domain}"
  type            = "TXT"
  ttl             = 600
  records         = ["v=DMARC1; p=none; rua=mailto:${var.notification_email}"]
  allow_overwrite = true
}

########################################################################################################
# Delivery events. This is not decoration: `pnpm test:mail:live` sends a message with a token in the
# subject, drains this queue, and asserts a SEND and then a DELIVERY carrying that token, and no
# BOUNCE, COMPLAINT or REJECT. It is the only way to prove a message actually left AWS (05).
########################################################################################################

resource "aws_sns_topic" "mail_events" {
  name = "${local.name_prefix}-mail-events"

  tags = { Name = "${local.name_prefix}-mail-events" }
}

resource "aws_sns_topic_policy" "mail_events" {
  arn = aws_sns_topic.mail_events.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSesPublish"
        Effect    = "Allow"
        Principal = { Service = "ses.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.mail_events.arn
        Condition = {
          StringEquals = { "AWS:SourceAccount" = local.account_id }
        }
      },
    ]
  })
}

resource "aws_sesv2_configuration_set_event_destination" "sns" {
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
  event_destination_name = "${local.name_prefix}-events-to-sns"

  event_destination {
    enabled              = true
    matching_event_types = ["SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT"]

    sns_destination {
      topic_arn = aws_sns_topic.mail_events.arn
    }
  }

  depends_on = [aws_sns_topic_policy.mail_events]
}

resource "aws_sqs_queue" "mail_events" {
  name                       = "${local.name_prefix}-mail-events"
  message_retention_seconds  = 345600 # four days, long enough to investigate a failed run on Monday
  visibility_timeout_seconds = 30
  sqs_managed_sse_enabled    = true

  tags = { Name = "${local.name_prefix}-mail-events" }
}

resource "aws_sns_topic_subscription" "mail_events_to_sqs" {
  topic_arn = aws_sns_topic.mail_events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.mail_events.arn

  # The test reads SES's event JSON, not an SNS envelope wrapped around it.
  raw_message_delivery = true
}

resource "aws_sqs_queue_policy" "mail_events" {
  queue_url = aws_sqs_queue.mail_events.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSnsDelivery"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.mail_events.arn
        Condition = {
          ArnEquals = { "aws:SourceArn" = aws_sns_topic.mail_events.arn }
        }
      },
    ]
  })
}
