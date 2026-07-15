output "state_bucket_name" {
  description = "S3 bucket name for Terraform remote state. Use this in the main configuration's backend block."
  value       = aws_s3_bucket.terraform_state.id
}

output "github_actions_role_arn" {
  description = "IAM role ARN that GitHub Actions assumes via OIDC. Set this as the AWS_DEPLOY_ROLE_ARN repository variable/secret."
  value       = aws_iam_role.github_actions.arn
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider registered in this account."
  value       = aws_iam_openid_connect_provider.github.arn
}
