import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** Requests a password-reset email. Always returns 200 (no account enumeration). */
export class AdminForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}
