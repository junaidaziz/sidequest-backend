import { ApiProperty } from '@nestjs/swagger';
import { ReferralChannel } from './record-invite.dto';

/** Response for `POST /referrals/invites`. */
export class InviteRecordedDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'whatsapp', description: 'The channel that was recorded.' })
  channel!: ReferralChannel;

  @ApiProperty({ example: 5, description: 'Total share events recorded for this user so far.' })
  totalInvitesSent!: number;
}
