import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Body for `POST /admin/users/:id/reset-verification`. Targets a specific one of
 * the user's `Completion` rows and moves its `verificationStatus` back to
 * `Pending` (an admin override, separate from — and not touching — the old
 * `AdminGuard`/`x-admin-key` `PATCH /admin/completions/:id/verification` route).
 */
export class ResetVerificationDto {
  @ApiProperty({ format: 'uuid', description: "Id of the user's completion to reset" })
  @IsUUID()
  completionId!: string;

  @ApiPropertyOptional({
    description: 'Optional operator reason, recorded in the audit log',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
