import { BadRequestException } from '@nestjs/common';
import { CMS_ALLOWED_IMAGE_MIME_TYPES, MAX_CMS_ASSET_BYTES } from '../../storage/storage.service';
import { CmsRequestContext } from '../types/cms.types';

/** Builds the per-request audit context threaded into every mutating service call. */
export function buildCtx(ip: string, userAgent?: string): CmsRequestContext {
  return { ipAddress: ip, userAgent: userAgent ?? null };
}

/**
 * Multer fileFilter rejecting any non-CMS-image upload at the HTTP boundary,
 * before it is buffered. The CMS allow-list (which permits SVG) is the single
 * source of truth; StorageService.buildCmsAssetKey re-checks it as defense in
 * depth, and CmsAssetService sanitizes any SVG before storage.
 */
export function cmsImageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (CMS_ALLOWED_IMAGE_MIME_TYPES[file.mimetype]) {
    cb(null, true);
    return;
  }
  cb(new BadRequestException('UNSUPPORTED_IMAGE_TYPE'), false);
}

/** Shared Multer options for a single CMS image upload. */
export const CMS_IMAGE_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_CMS_ASSET_BYTES, files: 1 },
  fileFilter: cmsImageFileFilter,
} as const;

/** Guards the presence of an uploaded file on a required-image route. */
export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw new BadRequestException('An image file is required');
  }
  return file;
}
