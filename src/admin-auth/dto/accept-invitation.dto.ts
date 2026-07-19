import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsAdminPassword } from '../validators/admin-password.validator';

/** Accepts a pending admin invitation by setting a password (token is a path param). */
export class AcceptInvitationDto {
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
