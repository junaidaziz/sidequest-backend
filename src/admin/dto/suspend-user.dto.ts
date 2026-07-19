import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `PATCH /admin/users/:id/suspend`. A reason is REQUIRED — suspending an
 * end-user account is a recorded operator action (written to the audit log and
 * persisted on `User.suspensionReason`), so intent must be captured, per the
 * spec's "all sensitive actions ... recorded in an audit log".
 */
export class SuspendUserDto {
  @ApiProperty({ description: 'Operator reason for the suspension', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
