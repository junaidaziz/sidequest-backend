import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Edits an admin's display name and/or role. Changing the role requires roles.assign. */
export class UpdateAdminDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ description: 'New Role id (reassignment requires roles.assign)' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
