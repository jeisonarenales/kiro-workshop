resource "random_id" "state_bucket_suffix" {
  byte_length = 4
}

locals {
  state_bucket_name = "${var.project_name}-tfstate-${random_id.state_bucket_suffix.hex}"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = local.state_bucket_name
  tags   = var.tags

  # Prevent accidental deletion of the bucket holding Terraform's own state
  # via a stray `terraform destroy` run against this bootstrap config.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    # Versioning lets you recover a previous state file if it's ever
    # corrupted or overwritten unexpectedly.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Note: state locking uses Terraform's native S3 locking (use_lockfile,
# GA since Terraform 1.11) configured in the main config's backend block —
# no DynamoDB table is needed for that. A table is not created here.
