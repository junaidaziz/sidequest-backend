import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Date-range filter shared by the analytics overview and CSV export. Both bounds
 * are optional ISO-8601 timestamps; when omitted the service defaults to the last
 * {@link DEFAULT_WINDOW_DAYS} days (resolved in AnalyticsService.resolveRange,
 * which also rejects an inverted from/to as a 400).
 *
 * Only the genuinely date-scoped metrics honour this range (new registrations +
 * their daily buckets, completions + XP awarded, the activation cohort, and the
 * "vs previous period" diff). Point-in-time metrics (total live users, proof
 * backlog, moderation snapshot, level distribution, registered device tokens,
 * queue depth) are current-state by nature and ignore it — documented per field
 * on the response DTOs.
 */
export class AnalyticsRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive lower bound (ISO 8601). Defaults to 7 days before `to`.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound (ISO 8601). Defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
