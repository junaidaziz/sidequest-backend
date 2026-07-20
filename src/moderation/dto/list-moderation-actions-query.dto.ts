import { ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationActionType, ModerationTargetType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Filters for `GET /admin/moderation-actions` — the read-only moderation-action
 * history. Filtering by `targetUserId` is the repeat-offender query (history is a
 * query over these rows, not a stored counter). Every field is optional.
 */
export class ListModerationActionsQueryDto {
  @ApiPropertyOptional({ description: '1-based page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @ApiPropertyOptional({ enum: ModerationActionType, description: 'Filter by action type' })
  @IsOptional()
  @IsEnum(ModerationActionType)
  actionType?: ModerationActionType;

  @ApiPropertyOptional({ enum: ModerationTargetType, description: 'Filter by target type' })
  @IsOptional()
  @IsEnum(ModerationTargetType)
  targetType?: ModerationTargetType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter to actions taken against one user (repeat-offender history)',
  })
  @IsOptional()
  @IsUUID()
  targetUserId?: string;
}
