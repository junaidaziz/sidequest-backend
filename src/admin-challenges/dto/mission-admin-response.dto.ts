import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MissionCategory, MissionDifficulty, MissionStatus, Prisma } from '@prisma/client';

/** One row in the paginated `GET /admin/missions` result. */
export class AdminMissionListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: MissionCategory })
  category!: MissionCategory;

  @ApiProperty({ enum: MissionDifficulty })
  difficulty!: MissionDifficulty;

  @ApiProperty({ enum: MissionStatus })
  status!: MissionStatus;

  @ApiProperty({ description: 'Generator visibility flag (derived from lifecycle status)' })
  isActive!: boolean;

  @ApiProperty()
  featured!: boolean;

  @ApiProperty()
  xpReward!: number;

  @ApiProperty()
  estimatedMinutes!: number;

  @ApiPropertyOptional({ nullable: true })
  sponsorName!: string | null;

  @ApiProperty({ description: 'Number of Completion rows referencing this mission' })
  completionCount!: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  approvedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** Paginated envelope for the mission list. */
export class AdminMissionPageDto {
  @ApiProperty({ type: [AdminMissionListItemDto] })
  items!: AdminMissionListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/** Full admin view of a single mission (`GET /admin/missions/:id`). */
export class AdminMissionDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: MissionCategory })
  category!: MissionCategory;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  fullBrief!: string;

  @ApiProperty()
  proofRequirement!: string;

  @ApiProperty()
  estimatedMinutes!: number;

  @ApiProperty()
  xpReward!: number;

  @ApiProperty({ enum: MissionDifficulty })
  difficulty!: MissionDifficulty;

  @ApiProperty()
  difficultyDots!: number;

  @ApiProperty({ type: [String] })
  crewTags!: string[];

  @ApiProperty({ type: [String] })
  settingTags!: string[];

  @ApiProperty()
  costTier!: number;

  @ApiProperty({ enum: MissionStatus })
  status!: MissionStatus;

  @ApiProperty({ description: 'Generator visibility flag (derived from lifecycle status)' })
  isActive!: boolean;

  @ApiProperty()
  featured!: boolean;

  @ApiPropertyOptional({ nullable: true })
  sponsorName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  startDate!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  endDate!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  participantLimit!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Ordered milestone definitions (JSON)' })
  milestones!: Prisma.JsonValue | null;

  @ApiPropertyOptional({ nullable: true })
  safetyNotice!: string | null;

  @ApiPropertyOptional({ nullable: true })
  iconKey!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  createdByAdminId!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  approvedByAdminId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  approvedAt!: Date | null;

  @ApiProperty({ description: 'Number of Completion rows referencing this mission' })
  completionCount!: number;

  @ApiProperty({ description: 'Number of SavedMission rows referencing this mission' })
  savedCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
