import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ModerationQueueSource } from '../types/moderation';

/**
 * Filters for `GET /admin/moderation/queue` — the unified, paginated view over
 * pending `Completion` proofs and pending `UserTaskSubmission` evidence. Every
 * field is optional; `source` narrows the queue to a single submission type.
 */
export class ModerationQueueQueryDto {
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

  @ApiPropertyOptional({
    enum: ModerationQueueSource,
    description: 'Narrow the queue to one submission type (proof completion vs. task submission)',
  })
  @IsOptional()
  @IsEnum(ModerationQueueSource)
  source?: ModerationQueueSource;
}
