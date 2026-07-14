import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional body for `POST /auth/logout`. When the client supplies the device's
 * push token, logout deregisters it (M21.3) so a shared device stops receiving
 * the logged-out user's pushes — matching the rigor the server-side
 * refresh-token revocation already applies. Omitting it still logs out (the
 * body is optional); the client just remains push-registered.
 */
export class LogoutDto {
  @ApiPropertyOptional({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description: "The current device's push token to deregister on logout.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  pushToken?: string;
}
