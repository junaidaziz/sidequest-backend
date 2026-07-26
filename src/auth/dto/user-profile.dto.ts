import { ApiProperty } from '@nestjs/swagger';
import { MediaVariantDto } from '../../media/dto/media-asset-response.dto';

/** Public-safe user projection — never exposes passwordHash or refreshTokenHash. */
export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, description: 'Null for guest accounts.' })
  email!: string | null;

  @ApiProperty({ nullable: true })
  displayName!: string | null;

  @ApiProperty({ description: 'True while the account is an anonymous guest session.' })
  isGuest!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://s3.example.com/avatars/…?X-Amz-Signature=…',
    description:
      'Delivery URL for the profile avatar; null when no avatar is set. When the avatar was ' +
      'uploaded through the media pipeline (see `avatarVariants`) this is the largest ready ' +
      "variant's URL — a stable CDN URL in production, a short-lived presigned GET URL otherwise. " +
      'For an avatar still on the legacy direct-upload path, this is a short-lived presigned GET URL ' +
      'resolved from the stored S3 object key at read time (never the raw key).',
  })
  avatarUrl!: string | null;

  @ApiProperty({
    type: [MediaVariantDto],
    description:
      'Every ready-to-render size of the current avatar, for responsive display (see the mobile ' +
      'ResponsiveImage component). Empty when the avatar is unset, still processing, or was ' +
      'uploaded through the legacy direct-upload path (in which case only `avatarUrl` is populated).',
  })
  avatarVariants!: MediaVariantDto[];
}
