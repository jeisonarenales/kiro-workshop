variable "aws_region" {
  description = "AWS region for the Terraform state bucket and lock table."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used to prefix generated resource names."
  type        = string
  default     = "sudoku-app"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, in \"owner/repo\" form."
  type        = string
  default     = "jeisonarenales/kiro-workshop"

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository must be in \"owner/repo\" form."
  }
}

variable "tags" {
  description = "Common tags applied to all resources created by this configuration."
  type        = map(string)
  default = {
    Project   = "sudoku-app"
    ManagedBy = "terraform-bootstrap"
  }
}
