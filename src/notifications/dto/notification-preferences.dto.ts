import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Read model for `GET /notifications/preferences`. */
export class NotificationPreferencesDto {
  @ApiProperty({ description: 'Master push switch. When false, no push is delivered.' })
  pushEnabled!: boolean;

  @ApiProperty({ description: 'Deliver push for task_* events.' })
  taskEventsEnabled!: boolean;

  @ApiProperty({ description: 'Deliver push for referral_* events.' })
  referralEventsEnabled!: boolean;

  @ApiProperty({ description: 'Deliver push for account_event notifications.' })
  accountEventsEnabled!: boolean;
}

/**
 * Body for `PATCH /notifications/preferences`. Every field optional — a partial
 * update touches only the flags supplied, leaving the rest unchanged.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  taskEventsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  referralEventsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  accountEventsEnabled?: boolean;
}
