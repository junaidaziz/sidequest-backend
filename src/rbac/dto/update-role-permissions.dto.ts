import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsString } from 'class-validator';

/** Replaces a non-system role's permission set with the given catalog keys. */
export class UpdateRolePermissionsDto {
  @ApiProperty({
    type: [String],
    description: 'Full desired set of dot-namespaced permission keys (replaces the current set)',
    example: ['users.view', 'users.suspend'],
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys!: string[];
}
