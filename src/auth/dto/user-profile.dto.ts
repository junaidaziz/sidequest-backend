import { ApiProperty } from '@nestjs/swagger';

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
      'Short-lived presigned GET URL for the profile avatar; null when no avatar is set. ' +
      'Resolved from the stored S3 object key at read time (never the raw key).',
  })
  avatarUrl!: string | null;
}
