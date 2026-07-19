import { ApiProperty } from '@nestjs/swagger';

/** A single admin session (device/login history), from GET /admin/auth/sessions. */
export class AdminSessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  userAgent!: string | null;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ nullable: true })
  lastUsedAt!: Date | null;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({ nullable: true })
  revokedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'True for the session the current request is authenticated with' })
  current!: boolean;
}
