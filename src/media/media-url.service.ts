import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { MEDIA_CDN_DOMAIN_ENV } from './media.constants';

/**
 * Resolves an S3 object key to a delivery URL — the single place this
 * decision is made, per the pipeline spec's "generate delivery URLs from the
 * object keys through a centralized media URL service" requirement.
 *
 * Two modes, chosen per-request by whether MEDIA_CDN_DOMAIN is set:
 *
 * - CDN mode (production, once infra/cloudfront.tf is applied): returns a
 *   stable `https://{MEDIA_CDN_DOMAIN}/{key}` URL. Stable because the object
 *   key never changes for a given variant — replacing an image creates a
 *   NEW MediaAsset with new keys (see avatar-replacement flow in
 *   MediaService) rather than overwriting bytes at the same key, so
 *   CloudFront's long-lived immutable caching is safe: the same URL always
 *   serves the same bytes, forever.
 * - Presigned fallback (local dev, or before CloudFront exists): returns a
 *   short-lived signed GET URL via StorageService. Works correctly but
 *   without CDN caching/stable-URL benefits — acceptable for dev, not
 *   intended as the production steady state.
 *
 * Never used for genuinely private media needing per-request authorization
 * beyond "this key exists" — see the class doc on MediaService for how PROOF
 * media, while served through this same resolver today, may need a stricter
 * signed-CloudFront-URL or backend-authorization-proxy model once the
 * proof-review privacy model is explicitly decided (flagged, not resolved,
 * in docs/backend/Media.md).
 */
@Injectable()
export class MediaUrlService {
  private readonly cdnDomain?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {
    this.cdnDomain = this.config.get<string>(MEDIA_CDN_DOMAIN_ENV) || undefined;
  }

  /** Whether URLs are currently coming from a real CDN vs. a presigned fallback. */
  get usingCdn(): boolean {
    return Boolean(this.cdnDomain);
  }

  async resolve(objectKey: string): Promise<string> {
    if (this.cdnDomain) {
      // Object keys never contain characters that need escaping (see the
      // key-builder in MediaService — uuid segments and a fixed extension
      // only), so a plain template is safe here without an encodeURI pass
      // that could double-encode an already-safe key.
      return `https://${this.cdnDomain}/${objectKey}`;
    }
    return this.storage.getSignedDownloadUrl(objectKey);
  }
}
