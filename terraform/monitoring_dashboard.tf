resource "aws_cloudwatch_dashboard" "site" {
  count = var.enable_monitoring_alarms ? 1 : 0

  provider = aws.us_east_1

  dashboard_name = "${var.project_name}-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Requests"
          region  = "us-east-1"
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.site.id, "Region", "Global"],
          ]
          period = 300
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Error rates (%)"
          region  = "us-east-1"
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/CloudFront", "4xxErrorRate", "DistributionId", aws_cloudfront_distribution.site.id, "Region", "Global"],
            ["AWS/CloudFront", "5xxErrorRate", "DistributionId", aws_cloudfront_distribution.site.id, "Region", "Global"],
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Bytes downloaded"
          region  = "us-east-1"
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/CloudFront", "BytesDownloaded", "DistributionId", aws_cloudfront_distribution.site.id, "Region", "Global"],
          ]
          period = 300
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Total error rate (%)"
          region  = "us-east-1"
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/CloudFront", "TotalErrorRate", "DistributionId", aws_cloudfront_distribution.site.id, "Region", "Global"],
          ]
          period = 300
          stat   = "Average"
        }
      },
    ]
  })
}
