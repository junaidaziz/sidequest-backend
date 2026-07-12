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
}
