# Origin Access Control: the current, AWS-recommended way to let a
# CloudFront distribution read from a private S3 bucket (replaces the
# legacy Origin Access Identity / OAI mechanism).
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-oac"
  description                       = "OAC for ${local.bucket_name} S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "${var.project_name} static site distribution"
  default_root_object = var.default_root_object
  price_class         = var.cloudfront_price_class
  aliases             = local.all_domain_names

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600  # 1 hour
    max_ttl     = 86400 # 1 day
  }

  # Single-page-app-style fallback: since this is a static site with no
  # server-side routing, missing objects are unusual, but mapping 403/404
  # back to the root object avoids a bare CloudFront/S3 XML error page for
  # a purely front-end app that might add client-side routes later.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/${var.default_root_object}"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/${var.default_root_object}"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.custom_domain_enabled ? null : true
    acm_certificate_arn            = local.custom_domain_enabled ? local.acm_certificate_arn : null
    ssl_support_method             = local.custom_domain_enabled ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain_enabled ? "TLSv1.2_2021" : null
  }

  tags = var.tags
}

locals {
  s3_origin_id = "${var.project_name}-s3-origin"

  # When using Route 53, wait for full validation before CloudFront picks up
  # the certificate (avoids a race against DNS propagation). When DNS is
  # external, the certificate ARN is usable immediately — the user is
  # responsible for completing validation via the records Terraform outputs.
  acm_certificate_arn = local.custom_domain_enabled ? (
    var.use_route53 ? aws_acm_certificate_validation.site[0].certificate_arn : aws_acm_certificate.site[0].arn
  ) : null
}

# Grants the CloudFront distribution (and only this specific distribution,
# via the aws:SourceArn condition) read access to the bucket. No other
# principal — including the bucket owner over the public internet — can
# read objects directly from S3.
data "aws_iam_policy_document" "cloudfront_oac_access" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.cloudfront_oac_access.json

  # The bucket policy must reference the distribution ARN, so it can only be
  # created after the distribution exists.
  depends_on = [aws_cloudfront_distribution.site]
}
