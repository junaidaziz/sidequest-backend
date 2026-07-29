import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MissionTagType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';

/** Creates a new mission tag in the Crew or Setting vocabulary. */
export class CreateMissionTagDto {
  @ApiProperty({ enum: MissionTagType, description: 'Which vocabulary this tag belongs to.' })
  @IsEnum(MissionTagType)
  type!: MissionTagType;

  @ApiProperty({
    example: 'Solo',
    minLength: 1,
    maxLength: 50,
    description: 'Canonical value stored in Mission.crewTags/settingTags.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  value!: string;

  @ApiProperty({
    example: 'Solo',
    minLength: 1,
    maxLength: 50,
    description: 'Human-facing label shown in the authoring UI.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label!: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Display order within the vocabulary (default 0).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Whether the tag is active (default true).' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
