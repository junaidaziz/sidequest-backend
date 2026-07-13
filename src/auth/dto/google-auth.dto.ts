import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6...',
    description:
      'Google-issued OpenID Connect ID token obtained client-side via Google Sign-In. ' +
      'Verified server-side against the configured web/iOS OAuth client IDs.',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
