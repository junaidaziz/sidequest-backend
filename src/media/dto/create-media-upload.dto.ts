import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaPurpose } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsMimeType,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ALLOWED_IMAGE_MIME_TYPES } from '../../storage/storage.service';

/**
 * Upload-authorization request body — the mobile app's first step in the
 * direct-to-S3 flow (see MediaService.createUploadAuthorization). Validated
 * against the actual MIME allow-list and per-purpose size cap before a
 * presigned URL is ever issued, so a client can't request an authorization
 * for a file type/size that would just be rejected at confirm time anyway.
 */
export class CreateMediaUploadRequestDto {
  @ApiProperty({ enum: MediaPurpose })
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @ApiProperty({
    example: 'photo.jpg',
    description: 'Original filename, used only to derive an extension.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'image/jpeg', enum: Object.keys(ALLOWED_IMAGE_MIME_TYPES) })
  @IsMimeType()
  mimeType!: string;

  @ApiProperty({
    example: 245_760,
    description:
      'Declared file size in bytes — re-verified against the real uploaded object at confirm time, never trusted alone.',
  })
  @IsInt()
  @IsPositive()
  fileSize!: number;

  @ApiPropertyOptional({
    description:
      'Original width in pixels, if known client-side. Informational only — re-read from the real file during processing.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  width?: number;

  @ApiPropertyOptional({ description: 'Original height in pixels, if known client-side.' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  height?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Id of the entity this media is FOR, interpreted per `purpose` (a Mission id for PROOF, a ' +
      'UserTask id for TASK_ATTACHMENT — never the Completion/UserTaskSubmission itself, which does ' +
      "not exist yet at upload time; it's created afterward referencing this media asset). Required " +
      'for those purposes, rejected for AVATAR (owner-scoped only, no separate parent entity) — see ' +
      'MediaService.assertAuthorized.',
  })
  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;
}

export class CreateMediaUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  mediaId!: string;

  @ApiProperty({
    description:
      'Presigned S3 PUT URL — upload the raw file body here with a matching Content-Type header.',
  })
  uploadUrl!: string;

  @ApiProperty({
    description:
      'The S3 object key this upload was authorized for. Included for logging/debugging; not needed to complete the upload.',
  })
  objectKey!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Headers the client must include on the PUT request (currently just Content-Type, bound into the signature).',
  })
  requiredHeaders?: Record<string, string>;

  @ApiProperty({
    format: 'date-time',
    description:
      'When this upload authorization expires — after this, the presigned URL is rejected by S3.',
  })
  expiresAt!: string;
}
