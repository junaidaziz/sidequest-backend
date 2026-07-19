import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsAdminPassword } from '../validators/admin-password.validator';

/**
 * Accepts a pending admin invitation by setting a password. The token travels in
 * the body (not the URL path) so it never lands in access/proxy logs.
 */
export class AcceptInvitationDto {
  @ApiProperty({ description: 'The raw invitation token from the emailed accept link' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  token!: string;

  @ApiProperty({ description: '12+ chars, at least 3 of 4 character classes' })
  @IsAdminPassword()
  password!: string;

  @ApiPropertyOptional({ description: 'Optional display name override' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;
}
