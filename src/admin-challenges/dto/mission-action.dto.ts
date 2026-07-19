import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Optional body shared by the lifecycle actions (publish / unpublish / archive /
 * feature / unfeature / duplicate / delete). A `reason` is never required — these
 * are first-party curated-content actions, not moderation of user-submitted
 * content — but when supplied it is captured in the audit-log entry for the
 * action. An empty body is valid (the global `forbidNonWhitelisted` pipe rejects
 * any field other than `reason`).
 */
export class MissionActionDto {
  @ApiPropertyOptional({ description: 'Optional operator note recorded in the audit log', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
