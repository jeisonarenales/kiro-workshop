# SNS topic that CloudWatch alarms (and, if enabled, the AWS Budgets alert)
# publish to. Created in us-east-1 alongside the alarms themselves, since
# CloudFront's CloudWatch metrics only exist in that region regardless of
# var.aws_region.

resource "aws_sns_topic" "alarms" {
  count = var.enable_monitoring_alarms || var.enable_budget_alert ? 1 : 0

  provider = aws.us_east_1

  name = "${var.project_name}-alarms"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count = (var.enable_monitoring_alarms || var.enable_budget_alert) && var.alarm_notification_email != null ? 1 : 0

  provider = aws.us_east_1

  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_notification_email
}

# ---------- CloudFront error-rate alarms ----------
#
# CloudFront publishes metrics to CloudWatch only in us-east-1, regardless
# of which region the rest of the account's resources live in.

resource "aws_cloudwatch_metric_alarm" "cloudfront_4xx_error_rate" {
  count = var.enable_monitoring_alarms ? 1 : 0

  provider = aws.us_east_1

  alarm_name          = "${var.project_name}-cloudfront-4xx-error-rate"
  alarm_description   = "CloudFront 4xx error rate exceeded ${var.error_rate_alarm_threshold}% for distribution ${aws_cloudfront_distribution.site.id}."
  namespace           = "AWS/CloudFront"
  metric_name         = "4xxErrorRate"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.error_rate_alarm_threshold
  evaluation_periods  = 3
  period              = 300 # 5 minutes
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = aws_cloudfront_distribution.site.id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_5xx_error_rate" {
  count = var.enable_monitoring_alarms ? 1 : 0

  provider = aws.us_east_1

  alarm_name          = "${var.project_name}-cloudfront-5xx-error-rate"
  alarm_description   = "CloudFront 5xx error rate exceeded ${var.error_rate_alarm_threshold}% for distribution ${aws_cloudfront_distribution.site.id}."
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.error_rate_alarm_threshold
  evaluation_periods  = 3
  period              = 300
  treat_missing_data  = "notBreaching"

  dimensions = {
    DistributionId = aws_cloudfront_distribution.site.id
    Region         = "Global"
  }

  alarm_actions = [aws_sns_topic.alarms[0].arn]
  ok_actions    = [aws_sns_topic.alarms[0].arn]

  tags = var.tags
}

# ---------- Cost monitoring ----------

resource "aws_budgets_budget" "monthly_cost" {
  count = var.enable_budget_alert ? 1 : 0

  name         = "${var.project_name}-monthly-budget"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project${"$"}${var.project_name}"]
  }

  dynamic "notification" {
    for_each = var.alarm_notification_email != null ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "FORECASTED"
      subscriber_email_addresses = [var.alarm_notification_email]
    }
  }

  dynamic "notification" {
    for_each = var.alarm_notification_email != null ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 100
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alarm_notification_email]
    }
  }
}
