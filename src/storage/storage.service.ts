import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * Image MIME types accepted for photo proofs, mapped to the file extension used
 * when building the S3 object key. Single source of truth — the controller's
 * Multer fileFilter and this service both key off it, so adding a format is a
 * one-line change here.
 */
export const ALLOWED_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * CMS-specific image allow-list. A superset of ALLOWED_IMAGE_MIME_TYPES that
 * additionally permits SVG — CMS content legitimately needs vector icons/logos.
 * SVG is a stored-XSS vector, so any SVG accepted under this list MUST be routed
 * through `sanitizeSvg` before storage (see CmsAssetService). Kept SEPARATE from
 * the user-facing proof/avatar allow-list on purpose: raw SVG must never become
 * acceptable on user-upload surfaces just because CMS needs it.
 */
export const CMS_ALLOWED_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** MIME type of SVG — the one CMS-allowed type that requires sanitization. */
export const SVG_MIME_TYPE = 'image/svg+xml';

/** Upper bound on a CMS asset upload (screenshot/testimonial avatar/cover/icon). */
export const MAX_CMS_ASSET_BYTES = 5 * 1024 * 1024;

/** Upper bound on a proof photo upload, enforced by the controller's Multer limits. */
export const MAX_PROOF_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Upper bound on an avatar upload — half the proof cap. An avatar is a small,
 * displayed-at-thumbnail-size image, so 5MB is generous while trimming the
 * upload-abuse surface and per-object S3 cost versus reusing the 10MB proof cap.
 */
export const MAX_AVATAR_PHOTO_BYTES = 5 * 1024 * 1024;

/** Presigned GET URL lifetime — short so proof photos aren't effectively public. */
const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Thin wrapper over an S3-compatible object store. Driven entirely by env config
 * so the same code runs against LocalStack in dev/test (S3_ENDPOINT set,
 * path-style addressing) and real AWS S3 in production (S3_ENDPOINT unset, the
 * SDK resolves the regional endpoint from S3_REGION).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    // Empty/undefined endpoint => let the SDK resolve the real AWS endpoint.
    const endpoint = config.get<string>('S3_ENDPOINT');
    this.client = new S3Client({
      region: config.getOrThrow<string>('S3_REGION'),
      endpoint: endpoint || undefined,
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
      // The SDK v3 default (`WHEN_SUPPORTED`) bakes an x-amz-checksum-crc32
      // requirement into every PutObjectCommand it signs — including a
      // presigned URL (getSignedUploadUrl). A raw client PUT (the mobile
      // app's fetch(), curl, anything not using this SDK) has no way to
      // produce a matching checksum, so every presigned upload would 400
      // with "Value for x-amz-checksum-crc32 header is invalid" — reproduced
      // for real against LocalStack, not a hypothetical. `WHEN_REQUIRED`
      // only attaches a checksum when a command explicitly opts in.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  /**
   * Builds a namespaced, collision-free object key for a user's proof photo.
   * Rejects any MIME type outside the allow-list with a 400 — this is the
   * authoritative extension/type check the storage layer owns.
   */
  buildProofKey(userId: string, contentType: string): string {
    return this.buildObjectKey('proofs', userId, contentType);
  }

  /**
   * Builds a namespaced, collision-free object key for a user's avatar image.
   * Namespaced under `avatars/` (never `proofs/`) so the two concerns stay in
   * separate prefixes. Same authoritative MIME allow-list check as proofs.
   */
  buildAvatarKey(userId: string, contentType: string): string {
    return this.buildObjectKey('avatars', userId, contentType);
  }

  /**
   * Builds a namespaced, collision-free object key for a user-task evidence
   * attachment (M19). Namespaced under `task-attachments/` so peer-to-peer task
   * evidence never shares a prefix with curated mission proofs or avatars, while
   * reusing the exact same allow-list/extension convention as those. Same
   * authoritative MIME allow-list check as proofs — the storage layer owns it.
   */
  buildTaskAttachmentKey(userId: string, contentType: string): string {
    return this.buildObjectKey('task-attachments', userId, contentType);
  }

  /**
   * Builds a namespaced, collision-free object key for a CMS asset. Unlike the
   * three per-user builders above, CMS assets are NOT user-owned, so there is no
   * `userId` segment — they live under `cms/<prefix>/…` (e.g. `cms/screenshots/`,
   * `cms/testimonials/`). Validates against the CMS-specific allow-list (which
   * permits SVG); the caller (CmsAssetService) is responsible for sanitizing any
   * SVG body before upload.
   */
  buildCmsAssetKey(prefix: string, contentType: string): string {
    const ext = CMS_ALLOWED_IMAGE_MIME_TYPES[contentType];
    if (!ext) {
      throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
    }
    return `cms/${prefix}/${randomUUID()}.${ext}`;
  }

  /**
   * Shared key builder for every per-user image object. Keeps the folder prefix
   * a parameter so proofs and avatars never hardcode each other's namespace, and
   * the allow-list/extension check lives in exactly one place.
   */
  private buildObjectKey(prefix: string, userId: string, contentType: string): string {
    const ext = ALLOWED_IMAGE_MIME_TYPES[contentType];
    if (!ext) {
      throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
    }
    return `${prefix}/${userId}/${randomUUID()}.${ext}`;
  }

  /** Puts an object into the configured bucket. */
  async uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.log(`Uploaded object ${key} (${body.length} bytes)`);
  }

  /**
   * Deletes an object from the configured bucket. S3's DeleteObject is itself
   * idempotent (deleting a missing key succeeds), so callers can invoke this to
   * clean up a replaced or removed avatar without a prior existence check.
   */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted object ${key}`);
  }

  /** Returns a short-lived presigned GET URL for a stored object. */
  async getSignedDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }

  /**
   * Returns a short-lived presigned PUT URL the mobile client uploads the
   * original image to directly — the "direct-to-S3" half of the media
   * pipeline (see MediaService.createUploadAuthorization). The backend never
   * sees the file body for this path, unlike the legacy Multer-mediated
   * `uploadObject` above (still used by the existing avatar/proof/task-
   * attachment multipart endpoints, kept for backward compatibility).
   *
   * `ContentType` is bound into the signature, so a client can't request a
   * URL for `image/jpeg` and then upload something else — S3 rejects a PUT
   * whose actual Content-Type header doesn't match what was signed.
   */
  async getSignedUploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * Returns the real, server-reported size (bytes) and content type of an
   * object already in the bucket, or `null` if it doesn't exist. Used by
   * MediaService.confirmUpload to verify a presigned-PUT upload actually
   * landed (and landed within the declared size limit) rather than trusting
   * whatever the client claimed at authorization time — a client could lie
   * about `fileSize` in the authorization request, but cannot lie about what
   * S3 actually received.
   */
  async headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof NotFound) {
        return null;
      }
      // S3-compatible test doubles (LocalStack) sometimes surface a missing
      // object as a generic error with name "NotFound" rather than the SDK's
      // typed NotFound class — treat that the same way rather than letting
      // it bubble as an unexpected 500.
      if (error instanceof Error && error.name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  /** Downloads an object's full body into memory. Used by the variant processor to read the original for resizing — original images are size-capped (see MEDIA_UPLOAD_LIMITS) specifically so this is always a bounded, safe amount of memory. */
  async downloadObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body;
    if (!body) {
      throw new Error(`Object ${key} has no body`);
    }
    const chunks: Uint8Array[] = [];
    // AWS SDK v3's Body is a Node.js Readable in this runtime (not a browser
    // ReadableStream/Blob) — iterate it directly rather than depending on
    // the SDK's `transformToByteArray()` helper, which isn't available on
    // every Body implementation LocalStack returns.
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
