output "bucket_name" {
  description = "Name of the private S3 bucket hosting the site content."
  value       = aws_s3_bucket.site.id
}

output "bucket_arn" {
  description = "ARN of the private S3 bucket."
  value       = aws_s3_bucket.site.arn
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution. Needed for cache invalidations after content updates."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name (*.cloudfront.net)."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  description = "Public HTTPS URL for the deployed Sudoku app, using the custom domain if configured, otherwise the CloudFront default domain."
  value       = "https://${local.custom_domain_enabled ? var.domain_name : aws_cloudfront_distribution.site.domain_name}/${var.default_root_object}"
}

output "custom_domain_names" {
  description = "All custom domain names configured as CloudFront aliases (empty if domain_name was not set)."
  value       = local.all_domain_names
}

output "acm_certificate_validation_records" {
  description = <<-EOT
    DNS validation records to create manually with your DNS provider when
    use_route53 is false. Empty when domain_name is unset or use_route53 is
    true (Terraform creates these automatically in that case).
  EOT
  value = local.custom_domain_enabled && !var.use_route53 ? {
    for dvo in aws_acm_certificate.site[0].domain_validation_options :
    dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}
}

output "custom_domain_dns_instructions" {
  description = "Manual DNS setup instructions, populated only when domain_name is set and use_route53 is false."
  value = local.custom_domain_enabled && !var.use_route53 ? join("\n", [
    "1. Create the CNAME validation record(s) shown in acm_certificate_validation_records with your DNS provider.",
    "2. Wait for ACM to validate the certificate (check: aws acm describe-certificate --certificate-arn ${try(aws_acm_certificate.site[0].arn, "")} --region us-east-1).",
    "3. Create a CNAME (or ALIAS, if your provider supports it) record for each of ${join(", ", local.all_domain_names)} pointing to ${aws_cloudfront_distribution.site.domain_name}.",
  ]) : null
}
