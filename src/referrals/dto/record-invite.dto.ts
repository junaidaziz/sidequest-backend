import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

/**
 * Closed set of share channels (M20.2 acceptance: `invitedVia` accepts only
 * this set). `copy_link` covers the "copied to clipboard" / native-share-sheet
 * fallback where the concrete destination app is unknown.
 */
export const REFERRAL_CHANNELS = [
  'whatsapp',
  'telegram',
  'messages',
  'email',
  'facebook',
  'x',
  'copy_link',
] as const;

export type ReferralChannel = (typeof REFERRAL_CHANNELS)[number];

/** Body for `POST /referrals/invites` — records a best-effort "share sent" event. */
export class RecordInviteDto {
  @ApiProperty({
    enum: REFERRAL_CHANNELS,
    example: 'whatsapp',
    description:
      'Share channel the client opened. Best-effort analytics — delivery is not confirmed.',
  })
  @IsString()
  @IsIn(REFERRAL_CHANNELS)
  channel!: ReferralChannel;
}
