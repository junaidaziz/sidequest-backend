import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `DELETE /admin/users/:id` (admin-initiated deletion / data request).
 * Requires both an explicit `confirm: true` and a recorded `reason` — deletion
 * is destructive and irreversible-feeling (it reuses the self-service
 * soft-delete + anonymization), so operator intent is captured before it runs
 * and written to the audit log.
 */
export class DeleteUserDto {
  @ApiProperty({ description: 'Must be true to confirm the deletion request', example: true })
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true to delete this account' })
  confirm!: boolean;

  @ApiProperty({
    description: 'Operator reason for the deletion request',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
