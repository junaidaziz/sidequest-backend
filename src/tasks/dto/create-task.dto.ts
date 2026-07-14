import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskVerificationMethod } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Verification methods a client may request at creation. `AUTOMATIC` is reserved
 * and not implemented in v1, so it is excluded from the accepted set (a request
 * for it is a 400) rather than silently accepted and never honoured.
 */
export const CREATABLE_VERIFICATION_METHODS: readonly TaskVerificationMethod[] = [
  TaskVerificationMethod.NONE,
  TaskVerificationMethod.SELF,
  TaskVerificationMethod.CREATOR_APPROVAL,
];

/** Upper bound on a task's reward, keeping a single task's XP grant sane. */
export const MAX_TASK_REWARD_XP = 100_000;

export class CreateTaskDto {
  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Walk the dog before noon' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Take the golden retriever around the block.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    enum: CREATABLE_VERIFICATION_METHODS,
    default: TaskVerificationMethod.NONE,
    description:
      'How completion is verified. AUTOMATIC is reserved and rejected. ' +
      'CREATOR_APPROVAL is only usable once an assignee is bound via invite — a ' +
      'self-completion (assignee-less) submission with it is rejected (Decision 2).',
  })
  @IsOptional()
  @IsIn(CREATABLE_VERIFICATION_METHODS)
  verificationMethod?: TaskVerificationMethod;

  @ApiPropertyOptional({
    default: false,
    description: 'When true, a submission must include at least one evidence attachment.',
  })
  @IsOptional()
  @IsBoolean()
  evidenceRequired?: boolean;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_TASK_REWARD_XP,
    example: 50,
    description: 'XP granted to the doer on approval. Feeds User.totalXp (Decision 3).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TASK_REWARD_XP)
  rewardXp?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-07-20T18:00:00.000Z',
    description: 'Optional due date (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
