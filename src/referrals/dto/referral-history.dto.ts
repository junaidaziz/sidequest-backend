import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReferralStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Offset/limit pagination for `GET /referrals/history`. */
export class ReferralHistoryQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Max records to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Records to skip.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** A single conversion referral in the caller's history. */
export class ReferralHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'The user who registered via the code.' })
  refereeId!: string;

  @ApiProperty({ enum: ReferralStatus })
  status!: ReferralStatus;

  @ApiProperty({ example: 'H7KMNP34', description: 'The code as used at signup time.' })
  code!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  registeredAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'XP awarded for this referral, or null if not yet rewarded.',
  })
  rewardXp!: number | null;
}

/** Paginated envelope for `GET /referrals/history`. */
export class PaginatedReferralHistoryDto {
  @ApiProperty({ type: [ReferralHistoryItemDto] })
  items!: ReferralHistoryItemDto[];

  @ApiProperty({ example: 12, description: 'Total conversion referrals for the caller.' })
  total!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}
