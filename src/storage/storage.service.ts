import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

/** Upper bound on a proof photo upload, enforced by the controller's Multer limits. */
export const MAX_PROOF_PHOTO_BYTES = 10 * 1024 * 1024;

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
    });
  }

  /**
   * Builds a namespaced, collision-free object key for a user's proof photo.
   * Rejects any MIME type outside the allow-list with a 400 — this is the
   * authoritative extension/type check the storage layer owns.
   */
  buildProofKey(userId: string, contentType: string): string {
    const ext = ALLOWED_IMAGE_MIME_TYPES[contentType];
    if (!ext) {
      throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
    }
    return `proofs/${userId}/${randomUUID()}.${ext}`;
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
    this.logger.log(`Uploaded proof object ${key} (${body.length} bytes)`);
  }

  /** Returns a short-lived presigned GET URL for a stored object. */
  async getSignedDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  }
}
