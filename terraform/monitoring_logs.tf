# CloudFront access logs: a separate, private S3 bucket that receives raw
# request logs from the distribution. Kept separate from the site content
# bucket so lifecycle/retention and access policies can differ (logs grow
# unboundedly over time; site content does not).

resource "aws_s3_bucket" "logs" {
  count = var.enable_access_logging ? 1 : 0

  bucket = "${local.bucket_name}-logs"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count = var.enable_access_logging ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  count = var.enable_access_logging ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    # CloudFront's standard (non-real-time) logging still delivers via the
    # legacy log-delivery group ACL mechanism, which requires ACLs to be
    # enabled (BucketOwnerPreferred), unlike the site content bucket which
    # uses BucketOwnerEnforced.
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "logs" {
  count = var.enable_access_logging ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id
  acl    = "log-delivery-write"

  depends_on = [aws_s3_bucket_ownership_controls.logs]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count = var.enable_access_logging ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count = var.enable_access_logging ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.access_log_retention_days
    }
  }
}
