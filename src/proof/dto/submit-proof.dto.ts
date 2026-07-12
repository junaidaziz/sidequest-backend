import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Validated portion of the multipart proof body. Only `caption` lives here: the
 * `photo` file is handled by the Multer FileInterceptor (never present in
 * `req.body`) and is documented via `@ApiBody` on the controller. It is
 * deliberately NOT a field on this DTO — with `useDefineForClassFields` (target
 * ES2022) an undecorated field becomes an own `undefined` property that the
 * global `forbidNonWhitelisted` ValidationPipe would reject on every request.
 *
 * Exactly one of photo/caption must be supplied; that mutual-exclusivity rule
 * spans the file field and this one, so it is enforced in ProofService.
 */
export class SubmitProofDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 500,
    example: 'Found the oldest building on the street — 1887!',
    description: 'Text proof caption. Provide this OR a photo, never both.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  caption?: string;
}
