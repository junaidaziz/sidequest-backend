import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Invites a new admin: creates a pending account and emails an invite link. */
export class InviteAdminDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({ description: 'The Role id to assign' })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({ description: 'Optional note (audited, not stored on the admin)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
