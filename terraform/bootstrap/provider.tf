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

  # Intentionally local backend: this configuration creates the remote
  # state bucket that the main configuration (../) will use. It can't
  # depend on that same bucket for its own state without a circular
  # bootstrapping problem.
}

provider "aws" {
  region = var.aws_region
}
