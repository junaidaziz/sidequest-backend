# Origin Access Control — the modern replacement for the older Origin Access
# Identity (OAI). Lets CloudFront authenticate to S3 with SigV4 without the
# bucket needing to be public, and without a separate IAM user's static
# credentials.
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "sidequest-media-oac"
  description                       = "OAC for the SideQuest media pipeline bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed policy — avoids hand-rolling a cache policy for a standard
# "cache everything, ignore query strings/cookies/headers" behavior, and
# avoids the deprecated `forwarded_values` block on the distribution itself.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# Minimal security response headers — the pipeline spec calls for "an
# appropriate response headers policy". Content-Type sniffing is the one
# that actually matters for served image bytes: without it, a browser could
# be tricked into interpreting a maliciously-crafted "image" as HTML/script
# if it were ever served with an unexpected or missing Content-Type.
resource "aws_cloudfront_response_headers_policy" "media" {
  name = "sidequest-media-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "media" {
  enabled             = true
  comment             = "SideQuest media pipeline — responsive image delivery"
  default_root_object = ""
  price_class         = var.price_class

  origin {
    domain_name              = data.aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "s3-media-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-media-origin"
    viewer_protocol_policy = "redirect-to-https"

    # Every object key is content-addressed by a fresh uuid (see
    # StorageService's key builders / buildVariantKey) — replacing an image
    # creates a NEW MediaAsset with new keys rather than overwriting bytes at
    # an existing key (see MediaUrlService's doc comment), so it is always
    # safe for CloudFront to cache a given URL as long as it wants to:
    # nothing ever invalidates in place. The AWS-managed CachingOptimized
    # policy (long TTL, no query-string/cookie/header variance) is exactly
    # right for that — no custom cache policy needed.
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.media.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.cdn_domain_name == "" ? true : false
    acm_certificate_arn            = var.cdn_domain_name == "" ? null : var.acm_certificate_arn
    ssl_support_method             = var.cdn_domain_name == "" ? null : "sni-only"
    minimum_protocol_version       = var.cdn_domain_name == "" ? null : "TLSv1.2_2021"
  }

  aliases = var.cdn_domain_name == "" ? [] : [var.cdn_domain_name]

  tags = var.tags
}
