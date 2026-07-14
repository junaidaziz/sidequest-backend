import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned when a creator generates an invite for a shared task. The token is
 * an opaque, unguessable string; `inviteUrl` is the deep link the mobile app
 * shares (per Decision 1, the invitee need not be pre-registered — a guest
 * session can accept it).
 */
export class InviteResponseDto {
  @ApiProperty({ description: 'Opaque invite token; also embedded in inviteUrl.' })
  inviteToken!: string;

  @ApiProperty({
    example: 'sidequest://tasks/invite/8f3c…',
    description: 'Deep link the app shares so an invitee can accept or decline.',
  })
  inviteUrl!: string;
}
