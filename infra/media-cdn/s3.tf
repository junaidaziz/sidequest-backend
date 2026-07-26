# Read-only reference to the EXISTING bucket — this module never creates,
# modifies bucket-level settings unrelated to CDN delivery, or destroys the
# bucket. If this data source fails to find the bucket, the bucket doesn't
# exist yet under this name/region and must be created out-of-band first
# (this module deliberately does not do that, per the "extend the existing
# bucket" decision — provisioning a brand-new bucket was the alternative
# explicitly not chosen).
data "aws_s3_bucket" "media" {
  bucket = var.media_bucket_name
}

# CORS so the Expo *web* target (native mobile is unaffected — it sends no
# Origin header) can PUT directly to a presigned URL from the browser.
# Scoped to PUT/GET only; no wildcard origin — `allowed_upload_origins` must
# be populated with real origins before this has any practical effect
# (empty list = no origins allowed, safest default).
resource "aws_s3_bucket_cors_configuration" "media" {
  count  = length(var.allowed_upload_origins) > 0 ? 1 : 0
  bucket = data.aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = var.allowed_upload_origins
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3000
  }
}

# Standard hygiene: a presigned PUT that's authorized but never completed (an
# abandoned upload) can leave an incomplete multipart part sitting in the
# bucket forever, silently costing storage. This does NOT address abandoned
# *completed* single-PUT uploads whose MediaAsset never reaches confirmUpload
# (i.e. rows stuck in PENDING_UPLOAD) — that cleanup is an application-level
# concern (a periodic sweep job), out of scope for this module, and not yet
# implemented anywhere in the backend as of this writing.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = data.aws_s3_bucket.media.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# Grants the CloudFront distribution (via its Origin Access Control identity)
# read access to the bucket. This is the ONLY bucket policy statement this
# module manages — `aws_s3_bucket_policy` sets the FULL policy document, not
# a merge, so if the real bucket already carries an unrelated policy
# statement, it must be folded into this document before applying (flagged
# here rather than silently overwritten).
data "aws_iam_policy_document" "media_cdn_read" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${data.aws_s3_bucket.media.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = data.aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_cdn_read.json
}
