import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CampaignTargetFilterDto } from './campaign-target-filter.dto';

/**
 * Body for `POST /admin/campaigns`. Creates the campaign as a `Draft`; nothing is
 * sent until an explicit `POST /admin/campaigns/:id/send`. `scheduledAt`, if set,
 * only takes effect at send time (a future value schedules a delayed fan-out; a
 * past/absent value sends immediately).
 */
export class CreateCampaignDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    description: 'Internal name for the admin list view',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    description: 'Notification title shown to recipients',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  headline!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    description: 'Notification body shown to recipients',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Optional deep-link payload copied onto each recipient notification',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: CampaignTargetFilterDto,
    description: 'Structured targeting criteria; omit to target every live, non-suspended user',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignTargetFilterDto)
  targetFilter?: CampaignTargetFilterDto;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'When to send (ISO-8601). A future value schedules; omit/past sends immediately.',
  })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
