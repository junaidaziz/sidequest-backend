import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'A valid, non-expired refresh token previously issued by the API.',
  })
  @IsString()
  @IsNotEmpty()
  @IsJWT()
  refreshToken!: string;
}
