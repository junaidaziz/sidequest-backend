import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserTaskStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

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
}
