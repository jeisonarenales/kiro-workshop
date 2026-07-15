variable "aws_region" {
  description = "AWS region where the S3 bucket is created. CloudFront itself is a global service."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = <<-EOT
    Name for the private S3 bucket that hosts the site content. Must be
    globally unique across all of AWS. If left as null, a unique name is
    generated automatically using the project name and a random suffix.
  EOT
  type        = string
  default     = null
}

variable "project_name" {
  description = "Short name used to prefix generated resource names (e.g. the S3 bucket, when bucket_name is not set)."
  type        = string
  default     = "sudoku-app"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class controlling which edge locations are used. One of PriceClass_All, PriceClass_200, PriceClass_100."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_All", "PriceClass_200", "PriceClass_100"], var.cloudfront_price_class)
    error_message = "cloudfront_price_class must be one of: PriceClass_All, PriceClass_200, PriceClass_100."
  }
}

variable "default_root_object" {
  description = "The object CloudFront serves for requests to the distribution root (e.g. https://<domain>/)."
  type        = string
  default     = "sudoku.html"
}

variable "site_source_dir" {
  description = "Local path to the directory containing the site files to upload (sudoku.html and the js/ folder). Defaults to the repository root, one level up from this Terraform configuration."
  type        = string
  default     = ".."
}

variable "enable_versioning" {
  description = "Whether to enable S3 bucket versioning, useful for rolling back accidental overwrites of site content."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Common tags applied to all resources created by this configuration."
  type        = map(string)
  default = {
    Project   = "sudoku-app"
    ManagedBy = "terraform"
  }
}

# ---------- Custom domain (optional) ----------
#
# Leave domain_name unset (the default) to use CloudFront's default
# *.cloudfront.net domain, exactly as before. Setting it provisions an ACM
# certificate and attaches it + the domain as a CloudFront alias.

variable "domain_name" {
  description = <<-EOT
    Custom domain name to serve the site from (e.g. "sudoku.example.com").
    Leave as null to use only the default *.cloudfront.net domain — no ACM
    certificate, Route 53 records, or aliases are created in that case.
  EOT
  type        = string
  default     = null
}

variable "subject_alternative_names" {
  description = "Additional domain names (SANs) to include on the ACM certificate and as CloudFront aliases, alongside domain_name. Ignored if domain_name is not set."
  type        = list(string)
  default     = []
}

variable "use_route53" {
  description = <<-EOT
    Whether the domain's DNS is managed in Route 53. When true (the
    default), Terraform automatically creates the ACM validation records
    and the final alias record in the given route53_zone_id. When false,
    Terraform only requests the certificate and outputs the DNS records you
    need to create manually with your external DNS provider.
  EOT
  type        = bool
  default     = true
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for domain_name. Required when domain_name is set and use_route53 is true."
  type        = string
  default     = null
}

