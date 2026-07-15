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

## Files

| File                 | Purpose                                                              |
|----------------------|-----------------------------------------------------------------------|
| `provider.tf`        | Terraform/provider version constraints, AWS provider configuration (including the `us-east-1` alias used for ACM) |
| `variables.tf`       | Configurable inputs (region, bucket name, price class, custom domain, tags, etc.) |
| `s3.tf`              | Private S3 bucket + public-access-block, encryption, versioning      |
| `cloudfront.tf`      | Origin Access Control, CloudFront distribution, S3 bucket policy     |
| `acm.tf`             | Optional ACM certificate + DNS validation + Route 53 alias record for a custom domain |
| `site_content.tf`    | Uploads `sudoku.html` and `js/*.js` as S3 objects                    |
| `outputs.tf`         | Bucket name/ARN, distribution ID/domain, site URL, custom domain outputs |

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
| `tags`                       | see `variables.tf` | Tags applied to every resource                                    |

## Cost and security notes

- This provisions **real, billable AWS resources** (S3 storage/requests and CloudFront data transfer/requests; ACM certificates themselves are free, but Route 53 hosted zones/queries are not). Review `terraform plan` before applying, and use the [AWS Pricing Calculator](https://calculator.aws/) for cost estimates specific to your expected traffic.
- The S3 bucket is never publicly reachable; `aws_s3_bucket_public_access_block` blocks public ACLs and policies at the bucket level regardless of any future misconfiguration attempt.
- CloudFront uses the default `*.cloudfront.net` certificate unless `domain_name` is set, in which case it uses a dedicated ACM certificate restricted to TLS 1.2+ (`minimum_protocol_version = "TLSv1.2_2021"`).
- No authentication is configured on the CloudFront distribution — the site is intended to be publicly readable (matching the app's original "open in any browser" design), just not directly reachable via S3.
