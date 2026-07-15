# Sudoku App — Terraform Bootstrap

This is a **separate, standalone** Terraform configuration from `../` (the
main infrastructure). It provisions the prerequisites that the main
configuration and CI/CD need before they can run:

1. An S3 bucket + DynamoDB table for Terraform's **remote state backend**
   (so state is shared between your local machine and GitHub Actions,
   instead of living only in a local `.tfstate` file).
2. A **GitHub Actions OIDC provider** + **IAM role** that GitHub Actions
   assumes to run `terraform plan`/`apply` — using short-lived, federated
   credentials instead of long-lived AWS access keys stored as repository
   secrets.

This module is deliberately kept separate from `../` (the main config) to
avoid a bootstrapping problem: the main config's remote state backend can't
be configured before the bucket that backend points to exists, and a
config can't easily manage the state bucket it stores its own state in.

## Usage

Run this **once**, manually, from your local machine (not from CI — CI
doesn't have credentials to assume a role yet, since the role doesn't
exist):

```bash
cd terraform/bootstrap
terraform init
terraform plan
terraform apply
```

Then note the outputs — you'll need them to configure the main
configuration's backend and the GitHub repository:

```bash
terraform output state_bucket_name
terraform output state_lock_table_name
terraform output github_actions_role_arn
```

## What this creates

| Resource | Purpose |
|---|---|
| `aws_s3_bucket.terraform_state` | Stores Terraform state files (versioned, encrypted, private) |
| `aws_dynamodb_table.terraform_locks` | Prevents concurrent `terraform apply` runs from corrupting state |
| `aws_iam_openid_connect_provider.github` | Trusts GitHub's OIDC token issuer (`token.actions.githubusercontent.com`) |
| `aws_iam_role.github_actions` | The role GitHub Actions assumes; trust policy is scoped to the specific repository below |
| `aws_iam_role_policy.github_actions` | Permissions granted to that role (S3, CloudFront, ACM, Route 53, IAM-policy-read needed by the main config) |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `aws_region` | `us-east-1` | Region for the state bucket/lock table |
| `github_repository` | `jeisonarenales/kiro-workshop` | `owner/repo` allowed to assume the deploy role |
| `github_branch_restriction` | `main` | Only workflow runs on this branch (or PRs targeting it) can assume the role for `apply`; PRs from other branches can still assume it for read-only `plan` — see the trust policy in `oidc.tf` |
| `project_name` | `sudoku-app` | Prefix for resource names |

## Security notes

- The IAM role's trust policy restricts `sts:AssumeRoleWithWebIdentity` to tokens whose `sub` claim matches this specific repository — no other GitHub repository (yours or anyone else's) can assume this role.
- No long-lived AWS credentials are ever stored in GitHub: the OIDC provider issues short-lived tokens valid only for the duration of a single workflow run.
- The role's permissions are scoped to the specific S3 bucket, CloudFront, ACM, and Route 53 actions the main configuration needs — not full `AdministratorAccess`.
- This bootstrap state itself is stored locally (`terraform/bootstrap/terraform.tfstate`) since it has no chicken-and-egg dependency to solve for itself. Keep this state file safe (or migrate it to its own remote backend later) — losing it means Terraform will try to recreate the state bucket/role from scratch.
