# The first thing in the stack, because it is the only resource whose job is to tell you the others
# have gone wrong. $5, two thresholds, and an address Terraform has already refused to plan without.

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Computed from the current month rather than hardcoded to a date in the past. Ignored after
  # creation so the first of each month is not a spurious diff.
  time_period_start = formatdate("YYYY-MM-01_00:00", plantimestamp())

  # Something has already happened.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }

  # Something is going to happen. Needs a few days of account history before AWS will forecast
  # anything, so on a new account this one stays quiet at first.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.notification_email]
  }

  lifecycle {
    ignore_changes = [time_period_start]
  }
}

########################################################################################################
# A second, independent signal. Budgets and CloudWatch fail differently, and the whole point of a
# cost guard is that it is still working on the day you need it.
#
# EstimatedCharges only exists in us-east-1, and an alarm can only notify a topic in its own region,
# so this pair is the only thing in the stack outside ap-south-1 apart from the CloudFront
# certificate.
########################################################################################################

resource "aws_sns_topic" "billing_alerts" {
  provider = aws.us_east_1
  name     = "${local.name_prefix}-billing-alerts"
}

resource "aws_sns_topic_subscription" "billing_alerts_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.billing_alerts.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

resource "aws_cloudwatch_metric_alarm" "estimated_charges" {
  provider = aws.us_east_1

  alarm_name          = "${local.name_prefix}-estimated-charges"
  alarm_description   = "Account charges for the month have passed the ${var.budget_limit_usd} USD ceiling."
  namespace           = "AWS/Billing"
  metric_name         = "EstimatedCharges"
  dimensions          = { Currency = "USD" }
  statistic           = "Maximum"
  period              = 21600 # billing metrics update roughly every six hours
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = tonumber(var.budget_limit_usd)
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.billing_alerts.arn]
  ok_actions    = [aws_sns_topic.billing_alerts.arn]
}
