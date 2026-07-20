import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppealStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Filters for `GET /admin/appeals`. Every field is optional; `status` narrows to
 * a single appeal-lifecycle state (typically `Pending` for the review queue).
 */
export class ListAppealsQueryDto {
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

  @ApiPropertyOptional({ enum: AppealStatus, description: 'Filter by appeal status' })
  @IsOptional()
  @IsEnum(AppealStatus)
  status?: AppealStatus;
}
