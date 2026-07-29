import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MissionCategory, MissionDifficulty } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CREW_VALUES, SETTING_VALUES } from '../../missions/dto/generate-missions.dto';
import { MissionMilestoneDto } from './mission-milestone.dto';

/**
 * The setting tags a mission can be authored with. Derived from the generator's
 * `SETTING_VALUES` minus `'Anywhere'`: `'Anywhere'` is a *query-side wildcard*
 * (`GenerateMissionsDto.setting === 'Anywhere'` short-circuits the setting match),
 * never a value a mission itself carries — a mission tagged `'Anywhere'` would
 * match no specific setting request and be dead weight. Excluding it here stops
 * an admin from authoring an unreachable mission.
 */
export const AUTHORABLE_SETTING_VALUES = SETTING_VALUES.filter(
  (value) => value !== 'Anywhere',
) as Exclude<(typeof SETTING_VALUES)[number], 'Anywhere'>[];

/**
 * KNOWN GAP (2026-07-28): `CREW_VALUES`/`AUTHORABLE_SETTING_VALUES` above are
 * still the source of truth for mission-authoring validation. The admin-managed
 * `MissionTag` table (`src/admin-mission-tags/`) was introduced the same day as
 * an editable vocabulary for the web admin panel, but this DTO was NOT wired to
 * validate against it — the two currently just happen to hold matching values
 * because `MissionTag` was seeded from these same constants. Deactivating or
 * renaming a tag via `/admin/mission-tags` does NOT affect what this endpoint
 * accepts. Wiring that coupling is a real follow-up, not done here to avoid
 * risking a regression in the existing admin-challenges e2e fixtures.
 */

/**
 * Body for `POST /admin/missions`. Covers the mission's content + admin-authoring
 * fields. Deliberately does NOT accept `status`, `isActive`, `featured`,
 * `approvedAt`/`approvedByAdminId`, or `createdByAdminId`: those are lifecycle
 * fields the service controls (a new mission is always created as `Draft` /
 * `isActive: false`, authored-by the caller) so an admin cannot slip a mission
 * straight into the live generator pool by hand-setting `isActive`. Generator
 * visibility only ever changes through the explicit publish/unpublish/archive
 * actions.
 *
 * `crewTags`/`settingTags` are constrained to the exact onboarding vocab the
 * generator sends (`CREW_VALUES` / `AUTHORABLE_SETTING_VALUES`) so a curated
 * mission is guaranteed to be reachable by `POST /missions/generate` rather than
 * silently un-matchable.
 */
export class CreateMissionDto {
  @ApiProperty({ description: 'Unique mission title', minLength: 3, maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: MissionCategory })
  @IsEnum(MissionCategory)
  category!: MissionCategory;

  @ApiProperty({
    description: 'Short teaser shown on the results card',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({
    description: 'Full brief shown in the detail sheet',
    minLength: 1,
    maxLength: 5000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  fullBrief!: string;

  @ApiProperty({ description: 'What proof the user must submit', minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  proofRequirement!: string;

  @ApiProperty({ description: 'Estimated minutes to complete', minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100000)
  estimatedMinutes!: number;

  @ApiProperty({ description: 'XP awarded on completion', minimum: 0, maximum: 100000 })
  @IsInt()
  @Min(0)
  @Max(100000)
  xpReward!: number;

  @ApiProperty({ enum: MissionDifficulty })
  @IsEnum(MissionDifficulty)
  difficulty!: MissionDifficulty;

  @ApiProperty({
    description: 'Filled difficulty dots shown in the UI (1-3)',
    minimum: 1,
    maximum: 3,
  })
  @IsInt()
  @Min(1)
  @Max(3)
  difficultyDots!: number;

  @ApiProperty({
    description: 'Onboarding crew values this mission suits',
    enum: [...CREW_VALUES],
    isArray: true,
    example: ['Solo', 'Partner'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CREW_VALUES, { each: true })
  crewTags!: string[];

  @ApiProperty({
    description: 'Onboarding setting values this mission suits',
    enum: AUTHORABLE_SETTING_VALUES,
    isArray: true,
    example: ['Outdoors', 'Nature'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(AUTHORABLE_SETTING_VALUES, { each: true })
  settingTags!: string[];

  @ApiProperty({
    description: '0=Free, 1=Under $10, 2=Under $30, 3=No limit',
    minimum: 0,
    maximum: 3,
  })
  @IsInt()
  @Min(0)
  @Max(3)
  costTier!: number;

  @ApiPropertyOptional({ description: 'Sponsor / promoted-challenge name', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sponsorName?: string;

  @ApiPropertyOptional({ description: 'Availability window start (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Availability window end (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Max participants, null = unlimited',
    minimum: 1,
    maximum: 10000000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000000)
  participantLimit?: number;

  @ApiPropertyOptional({
    description: 'Ordered milestone/checkpoint definitions',
    type: [MissionMilestoneDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MissionMilestoneDto)
  milestones?: MissionMilestoneDto[];

  @ApiPropertyOptional({ description: 'Safety notice shown to participants', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  safetyNotice?: string;

  @ApiPropertyOptional({ description: 'Design-system icon key', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  iconKey?: string;
}
