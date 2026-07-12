import { ApiProperty } from '@nestjs/swagger';
import { AuthTokensDto } from './auth-tokens.dto';
import { UserProfileDto } from './user-profile.dto';

/** Token pair plus the resulting user profile — returned by every endpoint
 * that establishes or refreshes a session, so the client never needs a
 * follow-up /auth/me round trip just to know who it's signed in as. */
export class AuthResponseDto extends AuthTokensDto {
  @ApiProperty({ type: UserProfileDto })
  user!: UserProfileDto;
}
