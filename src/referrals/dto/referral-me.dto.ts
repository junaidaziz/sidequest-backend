import { ApiProperty } from '@nestjs/swagger';

/**
 * The caller's referral code, shareable link, and aggregate stats. Returned by
 * `GET /referrals/me`, which lazily creates the code on the first-ever call.
 */
export class ReferralMeDto {
  @ApiProperty({ example: 'H7KMNP34', description: "The caller's unique referral code." })
  code!: string;

  @ApiProperty({
    example: 'sidequest://referrals/invite/H7KMNP34',
    description:
      'Deep link embedding the code, for the share sheet. The mobile app maps this ' +
      'to a universal/web link for recipients without the app installed (M20.4).',
  })
  inviteUrl!: string;

  @ApiProperty({
    example: 3,
    description: 'People who registered via this code (conversion referrals).',
  })
  totalReferrals!: number;

  @ApiProperty({
    example: 1,
    description: 'Referrals that reached their qualifying completion and were rewarded.',
  })
  completedReferrals!: number;

  @ApiProperty({
    example: 2,
    description: 'Registered referrals still awaiting their qualifying first completion.',
  })
  pendingReferrals!: number;

  @ApiProperty({
    example: 5,
    description: 'Best-effort count of share events recorded via POST /referrals/invites.',
  })
  invitesSent!: number;

  @ApiProperty({
    example: 50,
    description: 'Total XP earned from completed referrals (Decision 3, one currency).',
  })
  rewardsEarnedXp!: number;
}
