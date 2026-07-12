import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'adventurer@example.com' })
  // Must match the same normalization SignupDto applies, or a correctly
  // cased login would fail to find an account created with different casing.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'sup3r-s3cret-pass' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
