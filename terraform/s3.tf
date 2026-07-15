# Generates a short random suffix to keep the bucket name globally unique
# when the caller doesn't supply one explicitly.
resource "random_id" "bucket_suffix" {
  count       = var.bucket_name == null ? 1 : 0
  byte_length = 4
}

locals {
  bucket_name = coalesce(var.bucket_name, "${var.project_name}-${try(random_id.bucket_suffix[0].hex, "")}")

  # Maps file extensions to MIME types for the objects uploaded below, so
  # browsers receive correct Content-Type headers instead of S3's default
  # application/octet-stream.
  content_types = {
    ".html" = "text/html"
    ".js"   = "application/javascript"
    ".css"  = "text/css"
    ".json" = "application/json"
  }
}

resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name
  tags   = var.tags
}

# Private by default: block every form of public access at the bucket
# level. Content is only ever reachable through CloudFront via the Origin
# Access Control configured in cloudfront.tf.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    # Required by CloudFront OAC: object ownership must be bucket-owner-enforced.
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
