import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Blocks CRLF so a submitted value can never inject extra headers into the notification email. */
const NO_CRLF = /^[^\r\n]*$/;

/** Payload for the public `POST /contact` marketing-site form. */
export class CreateContactSubmissionDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Ada Lovelace' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ maxLength: 255, example: 'ada@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: 120, example: 'Partnership enquiry' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(NO_CRLF, { message: 'topic must not contain line breaks' })
  topic!: string;

  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}
