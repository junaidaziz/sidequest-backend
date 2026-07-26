import { ApiProperty } from '@nestjs/swagger';
import { MediaPurpose, MediaStatus } from '@prisma/client';

export class MediaVariantDto {
  @ApiProperty({
    example: 'md',
    description: 'Preset name — see media-variant-presets.ts for the dimensions behind each name.',
  })
  name!: string;

  @ApiProperty({
    description:
      'Delivery URL — a stable CDN URL in production, a short-lived presigned GET URL otherwise.',
  })
  url!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty({ example: 'webp' })
  format!: string;
}

/**
 * Response shape for a MediaAsset, returned by confirm-upload and GET
 * /media/:id. `variants` is empty while `status` is anything before READY —
 * clients should render a placeholder/skeleton and poll or await a push
 * update rather than treating an empty array as an error.
 */
export class MediaAssetResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: MediaPurpose })
  purpose!: MediaPurpose;

  @ApiProperty({ enum: MediaStatus })
  status!: MediaStatus;

  @ApiProperty({ type: [MediaVariantDto] })
  variants!: MediaVariantDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
