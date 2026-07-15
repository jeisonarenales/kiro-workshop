# ACM certificate for the optional custom domain. All resources here are
# conditional (count = 0 or 1) on var.domain_name being set — when it's
# null, none of this is created and the distribution falls back to the
# default CloudFront certificate, exactly as before this file existed.

locals {
  custom_domain_enabled = var.domain_name != null
  all_domain_names      = local.custom_domain_enabled ? concat([var.domain_name], var.subject_alternative_names) : []
}

check "route53_zone_required" {
  assert {
    condition     = !(local.custom_domain_enabled && var.use_route53 && var.route53_zone_id == null)
    error_message = "route53_zone_id must be set when domain_name is configured and use_route53 is true."
  }
}

# Must be created with the us-east-1 provider alias: CloudFront only
# accepts ACM certificates from that region, regardless of var.aws_region.
resource "aws_acm_certificate" "site" {
  count = local.custom_domain_enabled ? 1 : 0

  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = var.subject_alternative_names
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

# ---------- Route 53 path: fully automated validation ----------

resource "aws_route53_record" "cert_validation" {
  for_each = local.custom_domain_enabled && var.use_route53 ? {
    for dvo in aws_acm_certificate.site[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  count = local.custom_domain_enabled && var.use_route53 ? 1 : 0

  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# Alias record(s) pointing the custom domain(s) at the CloudFront
# distribution. CloudFront distributions have a fixed, well-known hosted
# zone ID for alias records (not region-specific).
resource "aws_route53_record" "site_alias" {
  for_each = local.custom_domain_enabled && var.use_route53 ? toset(local.all_domain_names) : []

  zone_id = var.route53_zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
