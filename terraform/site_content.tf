# Uploads the static site content to the private S3 bucket. Terraform
# tracks each object's content hash (etag) so `terraform apply` re-uploads
# a file only when it actually changes.

resource "aws_s3_object" "sudoku_html" {
  bucket       = aws_s3_bucket.site.id
  key          = "sudoku.html"
  source       = "${var.site_source_dir}/sudoku.html"
  etag         = filemd5("${var.site_source_dir}/sudoku.html")
  content_type = local.content_types[".html"]
  tags         = var.tags
}

# Discovers every .js file under js/ relative to the site source directory,
# so new modules are picked up automatically without editing this file.
locals {
  js_files = fileset("${var.site_source_dir}/js", "*.js")
}

resource "aws_s3_object" "js_files" {
  for_each = local.js_files

  bucket       = aws_s3_bucket.site.id
  key          = "js/${each.value}"
  source       = "${var.site_source_dir}/js/${each.value}"
  etag         = filemd5("${var.site_source_dir}/js/${each.value}")
  content_type = local.content_types[".js"]
  tags         = var.tags
}
