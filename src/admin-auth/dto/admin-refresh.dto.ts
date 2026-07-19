import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

/** Rotates the admin token pair using a valid refresh token. */
export class AdminRefreshDto {
  @ApiProperty()
  @IsJWT()
  refreshToken!: string;
}
