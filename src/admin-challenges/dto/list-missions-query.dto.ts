import { ApiPropertyOptional } from '@nestjs/swagger';
import { MissionCategory, MissionDifficulty, MissionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * The mission statuses an admin can filter the list by. Excludes
 * `PendingApproval`, which is a reserved-but-unimplemented enum value (no code
 * path ever sets it — see the schema comment on `MissionStatus`); allowing it as
 * a filter would only ever return an empty page and mislead the caller.
 */
export const FILTERABLE_MISSION_STATUSES = [
  MissionStatus.Draft,
  MissionStatus.Published,
  MissionStatus.Archived,
] as const;

/**
 * Coerces the common truthy/falsy query-string encodings into a real boolean so
 * `?featured=false` is respected (a bare `Boolean('false')` is `true`). Anything
 * else is left untouched for the validator to reject.
 */
function toOptionalBoolean(value: unknown): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

/**
 * Filters for `GET /admin/missions`. Every field is optional. `isActive` is
 * exposed as a *read-only* filter (generator visibility) even though it is not a
 * writable field on create/update — an admin can slice the list by "currently in
 * the live generator pool" without being able to flip the flag directly.
 * Soft-deleted missions are always excluded (no `deletedAt` filter is offered).
 */
export class ListMissionsQueryDto {
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
    enum: FILTERABLE_MISSION_STATUSES,
    description: 'Filter by lifecycle status (PendingApproval is reserved and not filterable)',
  })
  @IsOptional()
  @IsIn(FILTERABLE_MISSION_STATUSES)
  status?: (typeof FILTERABLE_MISSION_STATUSES)[number];

  @ApiPropertyOptional({ enum: MissionCategory, description: 'Filter by category' })
  @IsOptional()
  @IsEnum(MissionCategory)
  category?: MissionCategory;

  @ApiPropertyOptional({ enum: MissionDifficulty, description: 'Filter by difficulty' })
  @IsOptional()
  @IsEnum(MissionDifficulty)
  difficulty?: MissionDifficulty;

  @ApiPropertyOptional({ description: 'Filter by featured flag' })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ description: 'Filter by generator visibility (isActive) flag' })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}
