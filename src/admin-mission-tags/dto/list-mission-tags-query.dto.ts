import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { MissionTagType } from '@prisma/client';

/** Filters for the mission-tag list. All optional. */
export class ListMissionTagsQueryDto {
  @ApiPropertyOptional({ enum: MissionTagType, description: 'Restrict to one vocabulary.' })
  @IsOptional()
  @IsEnum(MissionTagType)
  type?: MissionTagType;

  @ApiPropertyOptional({
    description:
      'Include deactivated tags (default false — the authoring picker wants active tags only).',
  })
  @IsOptional()
  // Query params arrive as strings; coerce "true"/"false" to a real boolean.
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  includeInactive?: boolean;
}
