import { ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationTargetType, ReportStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Filters for `GET /admin/reports`. Every field is optional. `reason` is a free
 * substring match (the schema stores `Report.reason` as free text, not an enum),
 * so it is validated as a bounded string rather than an enum. Soft-deleted reports
 * are always excluded (no `deletedAt` filter is offered).
 */
export class ListReportsQueryDto {
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

  @ApiPropertyOptional({ enum: ReportStatus, description: 'Filter by triage status' })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ModerationTargetType, description: 'Filter by what was reported' })
  @IsOptional()
  @IsEnum(ModerationTargetType)
  targetType?: ModerationTargetType;

  @ApiPropertyOptional({ description: 'Case-insensitive substring match on the free-text reason' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
