import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_TASK_REWARD_XP } from './create-task.dto';

/**
 * Editable fields on a task, allowed only while the task is Open or Invited
 * (Decision 10 — edits lock once Accepted). Deliberately excludes
 * verificationMethod/evidenceRequired: those define the task's contract and are
 * fixed at creation so an assignee can't have the rules changed under them.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_TASK_REWARD_XP })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TASK_REWARD_XP)
  rewardXp?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
