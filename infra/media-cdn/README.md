# media-cdn (Terraform)

Provisions CloudFront + Origin Access Control in front of the **existing**
`sidequest-media` S3 bucket, for the responsive image pipeline
(`.claude/workflows/S3_RESPONSIVE_IMAGE_PIPELINE.md`, `src/media`).

## Status: written, reviewed, **never applied**

This module was authored and reviewed but deliberately not run against real
AWS. Do not `terraform apply` this without:

1. A real AWS session (the one used while writing this had an expired SSO
   token — `ExpiredToken` — which is *why* this was written-not-applied
   rather than applied directly).
2. Configuring a real Terraform state backend — `main.tf` has no `backend`
   block on purpose; add one (S3 + DynamoDB lock table, or Terraform Cloud)
   before the first apply, or state will default to local and be lost the
   moment anyone else needs to run this.
3. Reading `s3.tf`'s comment on `aws_s3_bucket_policy` — it sets the bucket's
   **entire** policy document, not a merge. If `sidequest-media` already
   carries an unrelated policy statement in production, fold it into
   `data.aws_iam_policy_document.media_cdn_read` first, or a real apply will
   silently drop it.

## What this does

- **Does not create or destroy the bucket** — `data "aws_s3_bucket"`
  references the existing one, per the reviewed decision to extend it with
  new key prefixes (`avatars/`, `proofs/`, `task-attachments/` — already
  live via `StorageService`'s key builders) rather than provision a
  dedicated bucket.
- Adds a bucket **lifecycle rule** aborting incomplete multipart uploads
  after 1 day (cheap hygiene; does not address DB rows stuck in
  `PENDING_UPLOAD` — that's an application-level sweep job, not built yet).
- Adds a **CORS configuration**, only if `allowed_upload_origins` is
  non-empty (default: empty, i.e. no effect) — relevant only to the Expo
  *web* target; native mobile sends no `Origin` header.
- Provisions a **CloudFront distribution** with an **Origin Access Control**
  (SigV4, not the legacy OAI) as the only principal allowed to read the
  bucket, using the AWS-managed `CachingOptimized` cache policy — safe to
  cache indefinitely because every object key is content-addressed by a
  fresh UUID (see `MediaUrlService`'s doc comment: replacing an image
  creates a new key, never overwrites one in place).

## After a real apply

Set the backend's `MEDIA_CDN_DOMAIN` env var (Railway) to this module's
`cloudfront_domain_name` output (or to `var.cdn_domain_name`, if a custom
domain + ACM cert were configured). Until that env var is set,
`MediaUrlService` keeps serving short-lived presigned S3 GET URLs — the app
works correctly either way, just without CDN caching.

## Usage

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars for the real environment
terraform init   # after adding a real backend block to main.tf
terraform plan
# review the plan carefully — especially the bucket policy diff — before:
terraform apply
```
