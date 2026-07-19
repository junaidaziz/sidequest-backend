import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { MissionMilestone } from '../types/mission-milestone';

/**
 * One entry in a mission's optional ordered milestone list (`Mission.milestones`,
 * stored as `Json?`). Validated per-element (rather than accepting freeform JSON)
 * so a malformed milestone is a 400 at the edge, not a shape surprise the mobile
 * client hits at render time. The whole array is optional — most missions are
 * single-step and carry no milestones at all.
 */
export class MissionMilestoneDto implements MissionMilestone {
  @ApiProperty({ description: 'Short milestone/checkpoint label', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Optional longer milestone detail', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Optional explicit ordering hint (0-based)', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
