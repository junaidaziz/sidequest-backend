import { MediaPurpose } from '@prisma/client';

/**
 * Centralized media pipeline: original upload -> background variant
 * generation -> delivery via CloudFront-or-presigned URL. Queue-name and
 * job-name constants live here so the producer (MediaProcessingQueueService)
 * and the consumer (MediaProcessingProcessor) can never drift apart on a
 * hard-coded string — same convention as verification.constants.ts.
 */
export const MEDIA_PROCESSING_QUEUE = 'media-processing';

/** Job name for generating every configured variant of a MediaAsset. */
export const GENERATE_VARIANTS_JOB = 'generate-variants';

/** Payload for a {@link GENERATE_VARIANTS_JOB} job. */
export interface GenerateVariantsJobData {
  mediaAssetId: string;
}

/**
 * Env var (seconds) controlling how long a presigned upload URL stays valid.
 * Kept short — an authorized-but-unused upload slot is a resource an attacker
 * could otherwise hold open indefinitely. Optional, defaults to 15 minutes.
 */
export const MEDIA_UPLOAD_URL_TTL_SECONDS_ENV = 'MEDIA_UPLOAD_URL_TTL_SECONDS';
export const DEFAULT_MEDIA_UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * Env var naming the stable CloudFront (or other CDN) domain images are
 * served from, e.g. "media.sidequest.app". When unset (local dev, or before
 * CloudFront is provisioned — see infra/media-cdn/), MediaUrlService falls
 * back to short-lived presigned S3 GET URLs so the app keeps working without
 * it, just without the caching/stable-URL benefits CloudFront provides.
 */
export const MEDIA_CDN_DOMAIN_ENV = 'MEDIA_CDN_DOMAIN';

/**
 * Per-purpose upload size caps, enforced twice: the presigned-upload
 * authorization step rejects an oversized declared `fileSize` up front, and
 * `MediaService.confirmUpload` re-checks the REAL uploaded size via a
 * `HeadObject` call against S3 before accepting the upload — this second
 * check is the one that actually matters, since a client can lie about
 * `fileSize` in the authorization request and S3 will accept a PUT of any
 * size regardless of what a presigned PUT URL was issued for (unlike a
 * presigned POST policy's `content-length-range` condition, which this
 * pipeline does not use — `StorageService.getSignedUploadUrl` signs a
 * `PutObjectCommand`, not `CreatePresignedPost`, so no such condition
 * applies here). Removing the `confirmUpload` HeadObject check would remove
 * the only real enforcement of these limits.
 *
 * Keyed by `MediaPurpose` (not a plain string) so a new enum member missing
 * an entry here is a compile error, not a silent `undefined` that makes both
 * size checks above evaluate to `false` and pass through unbounded.
 *
 * Mirrors the existing MAX_AVATAR_PHOTO_BYTES/MAX_PROOF_PHOTO_BYTES constants
 * in storage.service.ts (kept there too, unchanged, for the legacy Multer
 * upload path) — duplicated intentionally rather than imported, so the two
 * upload paths' limits can diverge deliberately if a future purpose needs a
 * different cap without an implicit coupling.
 */
export const MEDIA_UPLOAD_LIMITS: Readonly<Record<MediaPurpose, number>> = {
  AVATAR: 5 * 1024 * 1024,
  PROOF: 10 * 1024 * 1024,
  TASK_ATTACHMENT: 10 * 1024 * 1024,
};

/** Number of retry attempts for a failed variant-generation job. */
export const MEDIA_PROCESSING_MAX_ATTEMPTS = 3;
