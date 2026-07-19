import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CMS_ALLOWED_IMAGE_MIME_TYPES,
  StorageService,
  SVG_MIME_TYPE,
} from '../../storage/storage.service';
import { sanitizeSvgBuffer } from '../../storage/svg-sanitizer';

/**
 * CMS media pipeline over the generic StorageService. Owns the two CMS-specific
 * concerns the generic storage layer must not: (1) the CMS image allow-list
 * (which permits SVG) and (2) mandatory server-side SVG sanitization before any
 * SVG byte is persisted — raw admin-supplied SVG is a stored-XSS vector.
 */
@Injectable()
export class CmsAssetService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Validates, sanitizes (SVG only), and stores an uploaded CMS asset under
   * `cms/<prefix>/…`, returning the object key. Raster types are stored as-is;
   * SVG is routed through `sanitizeSvg` first. Rejects any type outside the CMS
   * allow-list with a 400.
   */
  async store(prefix: string, file: Express.Multer.File): Promise<string> {
    if (!CMS_ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
      throw new BadRequestException('UNSUPPORTED_IMAGE_TYPE');
    }
    // buildCmsAssetKey re-validates the MIME as defense in depth.
    const key = this.storage.buildCmsAssetKey(prefix, file.mimetype);
    const body = file.mimetype === SVG_MIME_TYPE ? sanitizeSvgBuffer(file.buffer) : file.buffer;
    await this.storage.uploadObject(key, body, file.mimetype);
    return key;
  }

  /** Resolves a stored object key to a short-lived presigned GET URL (or null). */
  async resolveUrl(key: string | null | undefined): Promise<string | null> {
    if (!key) {
      return null;
    }
    return this.storage.getSignedDownloadUrl(key);
  }

  /** Best-effort removal of a stored asset (S3 delete is itself idempotent). */
  async remove(key: string | null | undefined): Promise<void> {
    if (!key) {
      return;
    }
    await this.storage.deleteObject(key);
  }
}
