# Trusts GitHub Actions as a federated identity provider. AWS ignores the
# actual certificate thumbprint for OIDC providers using standard TLS (only
# used historically for validation); the value below is GitHub's current
# published thumbprint, kept for compatibility with the provider schema,
# which still requires the argument even though AWS no longer checks it.
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com",
  ]

  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
  ]

  tags = var.tags
}

# Trust policy: only the specified GitHub repository can assume this role,
# for any branch, tag, or pull request (":*" suffix on the sub claim). This
# is deliberately broad on "which ref" so that both `plan` (on PRs) and
# `apply` (on pushes to main) can use the same role — the workflow itself
# is what restricts `apply` to the main branch, not IAM. Restricting further
# (e.g. only refs/heads/main) here would block PR-triggered `plan` runs from
# authenticating at all.
data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.project_name}-github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_actions_trust.json
  tags               = var.tags
}

# Permissions scoped to exactly what the main Terraform configuration needs:
# managing the site's S3 bucket, its CloudFront distribution, the optional
# ACM certificate/Route53 records for a custom domain, and read-only IAM
# access needed to evaluate the bucket policy document. Deliberately not
# AdministratorAccess or a wildcard resource.
data "aws_iam_policy_document" "github_actions_permissions" {
  statement {
    sid    = "TerraformStateAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]
  }

  statement {
    sid    = "SiteS3BucketManagement"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:PutBucketPolicy",
      "s3:GetBucketPolicy",
      "s3:DeleteBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:GetBucketPublicAccessBlock",
      "s3:PutBucketOwnershipControls",
      "s3:GetBucketOwnershipControls",
      "s3:PutBucketVersioning",
      "s3:GetBucketVersioning",
      "s3:PutEncryptionConfiguration",
      "s3:GetEncryptionConfiguration",
      "s3:PutBucketTagging",
      "s3:GetBucketTagging",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
      # The aws_s3_bucket resource's Read function unconditionally queries
      # every one of these sub-configurations to populate its state, even
      # when the corresponding Terraform resource block (aws_s3_bucket_*)
      # isn't used — a bare "GetObject/PutObject/etc." set isn't enough and
      # produces sporadic 403s on refresh depending on which sub-config
      # Terraform happens to query in a given run.
      "s3:GetBucketAcl",
      "s3:PutBucketAcl",
      "s3:GetBucketCors",
      "s3:PutBucketCors",
      "s3:GetBucketWebsite",
      "s3:PutBucketWebsite",
      "s3:GetAccelerateConfiguration",
      "s3:PutAccelerateConfiguration",
      "s3:GetBucketRequestPayment",
      "s3:PutBucketRequestPayment",
      "s3:GetBucketLogging",
      "s3:PutBucketLogging",
      "s3:GetLifecycleConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:PutReplicationConfiguration",
      "s3:GetBucketObjectLockConfiguration",
      "s3:PutBucketObjectLockConfiguration",
      "s3:GetBucketLocation",
      # Object-level tagging: the aws_s3_object resource declares a `tags`
      # attribute, which routes through the provider's generic auto-tagging
      # framework — that framework calls GetObjectTagging/PutObjectTagging
      # on every read/write of a tagged object, distinct from the
      # bucket-level GetBucketTagging/PutBucketTagging above.
      "s3:GetObjectTagging",
      "s3:PutObjectTagging",
      "s3:DeleteObjectTagging",
    ]
    # Scoped to any bucket named like this project's site bucket
    # (project_name-*), not every bucket in the account.
    resources = [
      "arn:aws:s3:::${var.project_name}-*",
      "arn:aws:s3:::${var.project_name}-*/*",
    ]
  }

  statement {
    sid    = "CloudFrontManagement"
    effect = "Allow"
    actions = [
      "cloudfront:CreateDistribution",
      "cloudfront:GetDistribution",
      "cloudfront:UpdateDistribution",
      "cloudfront:DeleteDistribution",
      "cloudfront:TagResource",
      "cloudfront:UntagResource",
      "cloudfront:ListTagsForResource",
      "cloudfront:CreateOriginAccessControl",
      "cloudfront:GetOriginAccessControl",
      "cloudfront:UpdateOriginAccessControl",
      "cloudfront:DeleteOriginAccessControl",
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = ["*"] # CloudFront resources don't support resource-level ARN scoping for these actions
  }

  statement {
    sid    = "AcmAndRoute53ForCustomDomain"
    effect = "Allow"
    actions = [
      "acm:RequestCertificate",
      "acm:DescribeCertificate",
      "acm:DeleteCertificate",
      "acm:AddTagsToCertificate",
      "acm:ListTagsForCertificate",
      "route53:GetHostedZone",
      "route53:ListHostedZones",
      "route53:ChangeResourceRecordSets",
      "route53:GetChange",
      "route53:ListResourceRecordSets",
    ]
    resources = ["*"] # ACM/Route53 don't support meaningful resource-level scoping for these read/manage actions either
  }

  statement {
    sid       = "RandomIdSupport"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_actions" {
  name   = "${var.project_name}-deploy-permissions"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_permissions.json
}
