import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsISO8601, IsInt, IsOptional, Min } from 'class-validator';
import { CampaignPushPlatform, CampaignTargetFilter } from '../types/campaign-targeting';
import { IsGreaterOrEqualToField, IsNotSetWithField } from '../validators/target-range.validator';

/**
 * Structured targeting criteria for a campaign. Every dimension is optional; an
 * omitted/empty filter targets every live, non-suspended user.
 *
 * Deliberately absent dimensions (flagged, not faked — see the spec-gap note on
 * {@link CampaignTargetFilter}): **Country** and **App version** have no backing
 * column anywhere in the schema, so no field is exposed for them. **Notification
 * preference** is not a targeting field either — marketing opt-out is applied as
 * a per-recipient delivery gate at send time, not part of `targetFilter`.
 */
export class CampaignTargetFilterDto implements CampaignTargetFilter {
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Registered on/after this instant (User.createdAt >=)',
  })
  @IsOptional()
  @IsISO8601()
  registeredAfter?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Registered on/before this instant (User.createdAt <=)',
  })
  @IsOptional()
  @IsISO8601()
  @IsGreaterOrEqualToField('registeredAfter', {
    message: 'registeredBefore must be on or after registeredAfter',
  })
  registeredBefore?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Minimum lifetime XP (User.totalXp >=). Level is derived from totalXp, not stored.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minTotalXp?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Maximum lifetime XP (User.totalXp <=)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @IsGreaterOrEqualToField('minTotalXp', { message: 'maxTotalXp must be >= minTotalXp' })
  maxTotalXp?: number;

  @ApiPropertyOptional({ description: 'true = guest sessions only, false = full accounts only' })
  @IsOptional()
  @IsBoolean()
  isGuest?: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Recently active: last completion on/after this instant',
  })
  @IsOptional()
  @IsISO8601()
  activeSince?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Dormant: last completion before this instant, or never completed',
  })
  @IsOptional()
  @IsISO8601()
  @IsNotSetWithField('activeSince', {
    message: 'activeSince and inactiveSince are contradictory and cannot both be set',
  })
  inactiveSince?: string;

  @ApiPropertyOptional({
    description: 'Participation proxy: true = has >=1 Completion, false = none',
  })
  @IsOptional()
  @IsBoolean()
  hasParticipated?: boolean;

  @ApiPropertyOptional({
    enum: CampaignPushPlatform,
    description:
      'IMPERFECT PROXY: "has >=1 enabled push token on this platform", not a true per-user platform',
  })
  @IsOptional()
  @IsEnum(CampaignPushPlatform)
  pushPlatform?: CampaignPushPlatform;
}
