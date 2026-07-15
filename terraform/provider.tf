terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state: created once via terraform/bootstrap (see
  # terraform/bootstrap/README.md). Shared between local runs and GitHub
  # Actions so both operate on the same state instead of diverging. Uses
  # native S3 locking (use_lockfile, GA since Terraform 1.11) rather than
  # the deprecated DynamoDB-table locking mechanism.
  backend "s3" {
    bucket       = "sudoku-app-tfstate-d3042799"
    key          = "sudoku-app/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM certificates used by CloudFront must be requested in us-east-1,
# regardless of which region the rest of the infrastructure (the S3 bucket,
# var.aws_region) lives in. This alias is only exercised when a custom
# domain is configured (see acm.tf).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
