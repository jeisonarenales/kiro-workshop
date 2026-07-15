# Sudoku App — AWS Infrastructure (S3 + CloudFront)

Terraform configuration that hosts the Sudoku web app on a **private S3
bucket** fronted by **Amazon CloudFront**. The bucket has no public access
of any kind — CloudFront reaches it exclusively through an [Origin Access
Control (OAC)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html),
so the only way to reach the site is through the CloudFront distribution
over HTTPS.

## Architecture

```
                 ┌───────────────────────┐
  User (HTTPS)   │   CloudFront          │        OAC-signed request
 ───────────────▶│   Distribution        │───────────────────────────▶  ┌──────────────────┐
                 │   (default cert,      │                              │  S3 bucket        │
                 │   redirect-to-https)  │◀─────────────────────────────│  (private,        │
                 └───────────────────────┘        sudoku.html, js/*.js  │  no public access)│
                                                                         └──────────────────┘
```

- **S3 bucket**: `aws_s3_bucket_public_access_block` blocks all public ACLs/policies, `BucketOwnerEnforced` ownership, SSE-S3 encryption, and (by default) versioning enabled.
- **CloudFront**: single distribution, default cache behavior, HTTPS-only, serves `sudoku.html` as the default root object. 403/404 responses are mapped back to `sudoku.html` (harmless for this app today, and ready if client-side routes are added later).
- **Bucket policy**: grants `s3:GetObject` to the CloudFront service principal, scoped with an `aws:SourceArn` condition to this specific distribution only — no other CloudFront distribution or principal can read the bucket.
- **Site content**: `sudoku.html` and every file under `js/*.js` are uploaded as `aws_s3_object` resources, discovered automatically via `fileset()` so new JS modules don't require editing the Terraform config.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/downloads) >= 1.5.0
- An AWS account and credentials available to the AWS provider (environment variables, `~/.aws/credentials`, or an assumed role)
- The site files already exist one level up from this folder (`../sudoku.html` and `../js/*.js`) — this is the default for `var.site_source_dir`

## Usage

```bash
cd terraform
terraform init
terraform plan    # review what will be created
terraform apply   # provisions real, billable AWS resources — review the plan first
```

After `apply` completes, the app is reachable at the `site_url` output:

```bash
terraform output site_url
```

### Updating site content

Re-run `terraform apply` after changing `sudoku.html` or any file in `js/`.
Terraform detects content changes via each object's MD5 hash and only
re-uploads files that actually changed. CloudFront caches objects at edge
locations for up to `max_ttl` (1 day) by default — if you need changes to
appear immediately, invalidate the distribution's cache:

```bash
aws cloudfront create-invalidation \
  --distribution-id "$(terraform output -raw cloudfront_distribution_id)" \
  --paths "/*"
```

### Destroying

```bash
terraform destroy
```

This deletes the CloudFront distribution, S3 bucket, and all uploaded
objects. CloudFront distribution deletion can take several minutes since it
must first be disabled and fully propagated out of edge caches.

## CI/CD (GitHub Actions)

Pushes and pull requests against `main` automatically run Terraform via
`.github/workflows/terraform.yml`:

- **Pull requests** touching `terraform/`, `sudoku.html`, or `js/**` run `terraform fmt -check`, `validate`, and `plan`, then post the plan output as a PR comment.
- **Pushes to `main`** (i.e. after a PR merges) run `terraform apply` automatically, then invalidate the CloudFront cache so changes are visible immediately.

This requires a one-time setup, already partially done for this repository:

1. **Remote state backend + IAM role** (`terraform/bootstrap/`) — already applied; see `terraform/bootstrap/README.md`. This created:
   - An S3 bucket for Terraform state (`sudoku-app-tfstate-d3042799`), referenced in this configuration's `backend "s3"` block in `provider.tf`.
   - A GitHub OIDC provider + IAM role (`sudoku-app-github-actions-deploy`) that only `jeisonarenales/kiro-workshop` can assume — no AWS access keys are stored in GitHub.
2. **Repository variable** — add the role ARN as a repository variable so the workflow can reference it:
   - GitHub repo → **Settings → Secrets and variables → Actions → Variables tab → New repository variable**
   - Name: `AWS_DEPLOY_ROLE_ARN`
   - Value: `arn:aws:iam::148804864013:role/sudoku-app-github-actions-deploy`

   (A repository *variable*, not secret, is appropriate here — a role ARN isn't sensitive on its own; the OIDC trust policy is what actually restricts who can assume it.)
3. **(Optional) Production environment protection** — the `apply` job targets a GitHub Environment named `production`. Create it under **Settings → Environments** and add required reviewers if you want a manual approval gate before `apply` runs on merges to `main`.

Once the repository variable is set, merging any PR that touches the app or
infrastructure will automatically deploy it.

## Custom domain (optional)

By default the site is served from CloudFront's `*.cloudfront.net` domain.
To use your own domain (e.g. `sudoku.example.com`), set `domain_name` (and
optionally `subject_alternative_names` for extra names on the same
certificate). This is entirely opt-in — leaving `domain_name` unset behaves
exactly as before, with no ACM certificate or DNS resources created.

There are two supported paths, controlled by `use_route53`:

### Option A — Domain managed in Route 53 (fully automated)

If the domain's hosted zone already exists in Route 53, Terraform creates
the ACM certificate, its DNS validation records, waits for validation, and
creates the final alias record — all in one `apply`.

```hcl
# terraform.tfvars
domain_name     = "sudoku.example.com"
route53_zone_id = "Z1234567890ABC"   # aws route53 list-hosted-zones-by-name
# use_route53 = true  (default)
```

```bash
terraform apply
terraform output site_url   # now https://sudoku.example.com/sudoku.html
```

The first `apply` after adding a domain can take a few minutes while ACM
validates the certificate over DNS.

### Option B — Domain managed elsewhere (Cloudflare, GoDaddy, etc.)

Set `use_route53 = false`. Terraform requests the ACM certificate but
cannot create validation or alias records in a DNS provider it doesn't
manage — it instead outputs the records for you to create manually.

```hcl
# terraform.tfvars
domain_name = "sudoku.example.com"
use_route53 = false
```

```bash
terraform apply
terraform output acm_certificate_validation_records
terraform output custom_domain_dns_instructions
```

Create the CNAME validation record(s) shown, wait for ACM to validate the
certificate, then create a CNAME (or your provider's ALIAS/flattened-CNAME
equivalent) for `sudoku.example.com` pointing at the `cloudfront_domain_name`
output. Re-run `terraform apply` once validation completes if the
distribution needs to pick up the now-validated certificate.

### Notes

- ACM certificates for CloudFront must be issued in `us-east-1`; this is handled automatically via a provider alias (`aws.us_east_1` in `provider.tf`) regardless of `var.aws_region`.
- Removing `domain_name` (setting it back to `null`) and re-applying tears down the certificate, aliases, and any Route 53 records this configuration created — CloudFront falls back to its default domain.

## Monitoring

Infrastructure monitoring is enabled by default (`enable_access_logging` and
`enable_monitoring_alarms`, both `true`):

- **Access logs** — CloudFront delivers raw request logs to a dedicated, private S3 bucket (`<site-bucket>-logs`). Logs are automatically deleted after `access_log_retention_days` (90 by default) to control storage cost. This uses CloudFront's legacy standard-logging mechanism, which requires the log bucket to have ACLs enabled (`BucketOwnerPreferred` + `log-delivery-write` canned ACL) — this is the one exception to the "everything else is ACL-free / BucketOwnerEnforced" pattern used elsewhere in this configuration.
- **CloudWatch alarms** — two alarms (`<project>-cloudfront-4xx-error-rate`, `<project>-cloudfront-5xx-error-rate`) watch the distribution's error rate over a 15-minute window (3 × 5-minute periods) and fire when it exceeds `error_rate_alarm_threshold` (5% by default). CloudFront's CloudWatch metrics only exist in `us-east-1`, so these alarms (and the dashboard/SNS topic below) are created there via the `aws.us_east_1` provider alias regardless of `var.aws_region`.
- **CloudWatch dashboard** (`<project>-overview`) — requests, 4xx/5xx error rates, total error rate, and bytes downloaded, all in one view. URL: `terraform output cloudwatch_dashboard_url`.
- **SNS notifications** — alarms publish to an SNS topic (`<project>-alarms`). Set `alarm_notification_email` to get an email subscription created automatically (you'll need to confirm the subscription via the email AWS sends). Leave it unset to just create the topic and subscribe manually later, or via another protocol (SMS, Lambda, etc.).

To disable access logging or alarms entirely (e.g. for a throwaway/dev
deployment), set `enable_access_logging = false` and/or
`enable_monitoring_alarms = false`.

### Cost alerts (optional, opt-in)

Set `enable_budget_alert = true` (default `false`) to create an [AWS
Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
alert scoped to this project's tagged resources:

```hcl
# terraform.tfvars
enable_budget_alert      = true
monthly_budget_usd       = 10
alarm_notification_email = "you@example.com"
```

This notifies you at 80% of forecasted monthly spend and 100% of actual
spend, filtered to resources tagged `Project = <project_name>`. It's opt-in
(rather than on by default) since AWS Budgets are account-level constructs
and creating one automatically for every deployment of this configuration
felt presumptuous — untagged or differently-tagged costs in the same
account aren't covered by this filter.

## Analytics (not implemented — a product decision)

"Monitoring" above covers *infrastructure* health (is the site up, what's
the error rate, what's it costing). *User/product analytics* (who's
playing, which difficulty they choose, completion rates, session length)
is a different concern this configuration deliberately does not implement,
since the app is currently 100% static and client-side with zero tracking
— adding any of the options below is a product and privacy decision, not
just a Terraform change:

- **Privacy-respecting third-party script** (e.g. [Plausible](https://plausible.io/), [GoatCounter](https://www.goatcounter.com/), [Fathom](https://usefathom.com/)) — a small `<script>` tag added to `sudoku.html`. Simplest option; typically GDPR-friendly (no cookies, no PII) but still sends data to a third party, which should be disclosed to users.
- **Self-hosted analytics via CloudFront access logs** — the access logs already being collected above contain request-level data (path, timestamp, user agent, status). Querying them with [Athena](https://docs.aws.amazon.com/athena/latest/ug/cloudfront-logs.html) avoids a third party entirely, at the cost of building your own querying/dashboarding on top and lacking any client-side interaction data (difficulty selected, game completed, etc. — the app never sends that anywhere today).
- **In-app event tracking** — would require the app itself to emit events (e.g. via `fetch()` to a small serverless endpoint, or a client-side analytics SDK), which is a code change to the Sudoku app, not just infrastructure, and is the only option that could capture actual gameplay events rather than just page loads.

None of these are implemented here. If you want one, let me know which
approach and I'll implement it — happy to also flag the specific
disclosure/consent requirements (e.g. a cookie/privacy notice) that would
come with it.

## Files

| File                 | Purpose                                                              |
|----------------------|-----------------------------------------------------------------------|
| `provider.tf`        | Terraform/provider version constraints, AWS provider configuration (including the `us-east-1` alias used for ACM), S3 backend config |
| `variables.tf`       | Configurable inputs (region, bucket name, price class, custom domain, monitoring, tags, etc.) |
| `s3.tf`              | Private S3 bucket + public-access-block, encryption, versioning      |
| `cloudfront.tf`      | Origin Access Control, CloudFront distribution, S3 bucket policy     |
| `acm.tf`             | Optional ACM certificate + DNS validation + Route 53 alias record for a custom domain |
| `site_content.tf`    | Uploads `sudoku.html` and `js/*.js` as S3 objects                    |
| `monitoring_logs.tf`      | CloudFront access-logs S3 bucket (private, ACL-enabled for log delivery, lifecycle expiration) |
| `monitoring_alarms.tf`    | SNS topic, CloudWatch alarms for 4xx/5xx error rate, AWS Budgets alert |
| `monitoring_dashboard.tf` | CloudWatch dashboard summarizing requests/errors/bytes downloaded    |
| `outputs.tf`         | Bucket name/ARN, distribution ID/domain, site URL, custom domain and monitoring outputs |
| `bootstrap/`         | Standalone, one-time-apply config for the state backend + GitHub OIDC/IAM role (see `bootstrap/README.md`) |
| `../.github/workflows/terraform.yml` | CI/CD workflow: plan on PRs, apply on push to `main` |

## Configuration

All variables have sensible defaults; override them in a `terraform.tfvars`
file or via `-var` flags if needed.

| Variable                    | Default          | Description                                                        |
|------------------------------|------------------|----------------------------------------------------------------------|
| `aws_region`                 | `us-east-1`      | Region for the S3 bucket (CloudFront itself is global)              |
| `bucket_name`                | `null`           | Explicit bucket name; auto-generated with a random suffix if unset  |
| `project_name`               | `sudoku-app`     | Prefix used for generated resource names                            |
| `cloudfront_price_class`     | `PriceClass_100` | Controls which CloudFront edge locations are used (cost vs. reach)  |
| `default_root_object`        | `sudoku.html`    | Object served for requests to the distribution root                 |
| `site_source_dir`            | `..`             | Local path to the site files (`sudoku.html`, `js/`)                 |
| `enable_versioning`          | `true`           | Whether to enable S3 bucket versioning                              |
| `domain_name`                | `null`           | Custom domain for the site; unset means CloudFront's default domain |
| `subject_alternative_names`  | `[]`             | Additional domain names on the same ACM certificate                 |
| `use_route53`                | `true`           | Whether to automate DNS validation/records via Route 53             |
| `route53_zone_id`            | `null`           | Required when `domain_name` is set and `use_route53` is true        |
| `enable_access_logging`      | `true`           | Whether to enable CloudFront access logging to S3                   |
| `access_log_retention_days`  | `90`             | Days to retain access logs before automatic deletion                |
| `enable_monitoring_alarms`   | `true`           | Whether to create CloudWatch alarms + dashboard for error rates      |
| `error_rate_alarm_threshold` | `5`              | Error-rate percentage (4xx/5xx) above which alarms trigger          |
| `alarm_notification_email`   | `null`           | Email to subscribe to the alarms/budget SNS topic; unset = no subscription |
| `enable_budget_alert`        | `false`          | Whether to create an AWS Budgets cost alert (opt-in)                |
| `monthly_budget_usd`         | `10`             | Monthly cost threshold (USD) for the budget alert                   |
| `tags`                       | see `variables.tf` | Tags applied to every resource                                    |

## Cost and security notes

- This provisions **real, billable AWS resources** (S3 storage/requests and CloudFront data transfer/requests; ACM certificates themselves are free, but Route 53 hosted zones/queries are not; CloudWatch alarms/dashboards have a small per-resource monthly cost). Review `terraform plan` before applying, and use the [AWS Pricing Calculator](https://calculator.aws/) for cost estimates specific to your expected traffic.
- The S3 bucket is never publicly reachable; `aws_s3_bucket_public_access_block` blocks public ACLs and policies at the bucket level regardless of any future misconfiguration attempt. The access-logs bucket is also fully private — only CloudFront's log-delivery mechanism can write to it.
- CloudFront uses the default `*.cloudfront.net` certificate unless `domain_name` is set, in which case it uses a dedicated ACM certificate restricted to TLS 1.2+ (`minimum_protocol_version = "TLSv1.2_2021"`).
- No authentication is configured on the CloudFront distribution — the site is intended to be publicly readable (matching the app's original "open in any browser" design), just not directly reachable via S3.
- No user/product analytics or tracking is implemented — see the Analytics section above.
