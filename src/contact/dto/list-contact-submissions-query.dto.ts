import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContactSubmissionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Filters + pagination for the admin contact-submission list. */
export class ListContactSubmissionsQueryDto {
  @ApiPropertyOptional({ enum: ContactSubmissionStatus, description: 'Filter by triage status.' })
  @IsOptional()
  @IsEnum(ContactSubmissionStatus)
  status?: ContactSubmissionStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
