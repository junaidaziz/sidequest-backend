import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationCampaignStatus } from '@prisma/client';

/** One row in the paginated `GET /admin/campaigns` result. */
export class CampaignListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Internal name for the admin list view' })
  title!: string;

  @ApiProperty({ enum: NotificationCampaignStatus })
  status!: NotificationCampaignStatus;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  scheduledAt!: Date | null;

  @ApiProperty({ description: 'Recipients resolved at send time (0 until sent)' })
  totalRecipients!: number;

  @ApiProperty({ description: 'Recipients successfully delivered to' })
  sentCount!: number;

  @ApiProperty({ description: 'Recipients whose delivery failed' })
  failedCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/**
 * Real, derivable delivery + engagement analytics for a campaign.
 *
 * NOT included, because no backing infrastructure exists (flagged, not faked —
 * this is Phase 11's counterpart to earlier phases' honest data-gap adaptations):
 *   - **click tracking** — no link-tracking/redirect layer exists anywhere.
 *   - **conversion tracking** — no attribution model exists anywhere.
 * Do not add `clickCount`/`conversionCount` fields without real backing data.
 */
export class CampaignStatsDto {
  @ApiProperty({ description: 'Total recipient rows for the campaign' })
  totalRecipients!: number;

  @ApiProperty({ description: 'Recipients still awaiting processing' })
  pending!: number;

  @ApiProperty({ description: 'Recipients successfully delivered to' })
  sent!: number;

  @ApiProperty({ description: 'Recipients whose delivery failed' })
  failed!: number;

  @ApiProperty({
    description: 'Recipients skipped (e.g. marketing opt-out) — no notification sent',
  })
  skipped!: number;

  @ApiProperty({
    description: 'Delivered notifications the recipient has since opened (readAt set)',
  })
  openCount!: number;

  @ApiProperty({
    description: 'openCount / sent, in [0,1]; 0 when nothing has been sent yet',
    minimum: 0,
    maximum: 1,
  })
  openRate!: number;
}

/** Full campaign view (`GET /admin/campaigns/:id`) including real stats. */
export class CampaignDetailDto extends CampaignListItemDto {
  @ApiProperty({ description: 'Notification title shown to recipients' })
  headline!: string;

  @ApiProperty({ description: 'Notification body shown to recipients' })
  body!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Deep-link payload copied onto each recipient notification',
  })
  data!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Structured targeting criteria resolved at send time',
  })
  targetFilter!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  startedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  completedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  createdByAdminId!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  updatedByAdminId!: string | null;

  @ApiProperty({ type: CampaignStatsDto, description: 'Real delivery + open analytics' })
  stats!: CampaignStatsDto;
}

/** Paginated envelope for the campaign list. */
export class CampaignPageDto {
  @ApiProperty({ type: [CampaignListItemDto] })
  items!: CampaignListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/**
 * Lightweight "this will reach N users" response for
 * `POST /admin/campaigns/:id/preview-audience`. Read-only: resolves the saved
 * `targetFilter` to a count and creates NO recipient rows.
 */
export class PreviewAudienceDto {
  @ApiProperty({
    description: 'Live, non-suspended users the saved targetFilter currently resolves to',
  })
  count!: number;
}
