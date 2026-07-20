import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationCampaignStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Filters for `GET /admin/campaigns` — the paginated campaign list. Every field
 * is optional; `status` narrows the list to one lifecycle state. Soft-deleted
 * campaigns are always excluded (not a client-controllable filter).
 */
export class ListCampaignsQueryDto {
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

  @ApiPropertyOptional({ enum: NotificationCampaignStatus, description: 'Narrow to one status' })
  @IsOptional()
  @IsEnum(NotificationCampaignStatus)
  status?: NotificationCampaignStatus;
}
