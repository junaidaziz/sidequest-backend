import { ApiProperty } from '@nestjs/swagger';

/** Token pair returned by guest bootstrap, signup, login, and refresh. */
export class AuthTokensDto {
  @ApiProperty({
    description: 'Short-lived JWT sent as `Authorization: Bearer` on protected routes.',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Long-lived JWT exchanged at /auth/refresh for a new token pair.',
  })
  refreshToken!: string;
}
