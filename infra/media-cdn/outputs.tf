output "cloudfront_distribution_id" {
  description = "CloudFront distribution id — needed to issue cache invalidations, if ever required."
  value       = aws_cloudfront_distribution.media.id
}

output "cloudfront_domain_name" {
  description = <<-EOT
    The distribution's default *.cloudfront.net domain. Set the backend's
    MEDIA_CDN_DOMAIN env var to this value (or to var.cdn_domain_name, if a
    custom domain + ACM cert were configured) once this module is applied —
    MediaUrlService falls back to presigned S3 GET URLs until that env var
    is set.
  EOT
  value = aws_cloudfront_distribution.media.domain_name
}

output "media_bucket_arn" {
  description = "ARN of the existing bucket this module extends."
  value       = data.aws_s3_bucket.media.arn
}
