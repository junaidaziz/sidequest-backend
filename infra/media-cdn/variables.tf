variable "aws_region" {
  description = "AWS region the existing media bucket lives in. Must match the backend's S3_REGION env var."
  type        = string
  default     = "us-east-1"
}

variable "media_bucket_name" {
  description = <<-EOT
    Name of the EXISTING S3 bucket to extend with CloudFront delivery — per
    the reviewed decision to reuse the bucket already referenced by the
    backend's S3_BUCKET env var (sidequest-media) rather than provision a
    dedicated new one. This module never creates or destroys the bucket
    itself (see s3.tf's `data "aws_s3_bucket"`), only adds a CORS
    configuration, a lifecycle rule, and a bucket policy statement granting
    the new CloudFront distribution read access.
  EOT
  type        = string
}

variable "cdn_domain_name" {
  description = <<-EOT
    Optional custom domain (e.g. "media.sidequest.app") to serve the CDN
    from, fronted by an ACM certificate in us-east-1 (CloudFront requirement
    regardless of `aws_region` above). Leave empty to use only the default
    *.cloudfront.net domain — the backend's MEDIA_CDN_DOMAIN env var can
    point at either.
  EOT
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in us-east-1, covering `cdn_domain_name`. Required only if cdn_domain_name is set."
  type        = string
  default     = ""
}

# A `variable` block's own `validation.condition` can only reference that
# variable itself, not `var.cdn_domain_name` too — a `check` block (also
# supported since Terraform 1.5.0, matching this module's `required_version`)
# is the version-compatible way to validate the relationship between the two.
# Without this, setting cdn_domain_name with acm_certificate_arn left at its
# empty default passes `terraform plan` silently and only fails at
# `terraform apply` time against CloudFront's own API, with a much less
# obvious error.
check "acm_certificate_required_for_custom_domain" {
  assert {
    condition     = var.cdn_domain_name == "" || var.acm_certificate_arn != ""
    error_message = "acm_certificate_arn must be set when cdn_domain_name is set — CloudFront requires a valid ACM certificate (in us-east-1) for any custom domain alias."
  }
}

variable "allowed_upload_origins" {
  description = <<-EOT
    Origins allowed by the bucket's CORS configuration to PUT directly via a
    presigned URL. Native mobile clients (the primary consumer of
    POST /media/uploads) don't send an Origin header and are unaffected by
    CORS either way — this only matters for the Expo web target and any
    future browser-based admin upload tooling.
  EOT
  type    = list(string)
  default = []
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 (US/Canada/Europe) is the cheapest tier — widen only if the user base needs it."
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default = {
    Project   = "sidequest"
    Component = "media-pipeline"
    ManagedBy = "terraform"
  }
}
