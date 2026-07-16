import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserTaskStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Which side of a task the caller wants listed. */
export type TaskRoleFilter = 'creator' | 'assignee' | 'all';

export const TASK_ROLE_FILTERS: readonly TaskRoleFilter[] = ['creator', 'assignee', 'all'];

/**
 * Query filters for `GET /tasks`. Both optional: with neither, the caller gets
 * every non-deleted task where they are creator or assignee.
 */
export class ListTasksQueryDto {
  @ApiPropertyOptional({ enum: UserTaskStatus, description: 'Filter by task status.' })
  @IsOptional()
  @IsEnum(UserTaskStatus)
  status?: UserTaskStatus;

  @ApiPropertyOptional({
    enum: TASK_ROLE_FILTERS,
    default: 'all',
    description: "Filter by the caller's relationship to the task.",
  })
  @IsOptional()
  @IsIn(TASK_ROLE_FILTERS)
  role?: TaskRoleFilter;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Max records to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Records to skip.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
