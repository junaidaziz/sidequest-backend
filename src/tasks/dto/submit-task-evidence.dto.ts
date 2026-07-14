import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Validated portion of the multipart evidence-submission body. Like
 * SubmitProofDto, the binary `photo` file is handled by the Multer
 * FileInterceptor (never present in `req.body`) and documented via `@ApiBody` on
 * the controller — it is intentionally NOT a field here, because with
 * `useDefineForClassFields` an undecorated field becomes an own `undefined`
 * property the global `forbidNonWhitelisted` pipe would reject.
 */
export class SubmitTaskEvidenceDto {
  @ApiPropertyOptional({
    maxLength: 2000,
    example: 'Done — photo attached of the finished bookshelf.',
    description: 'Optional free-text notes accompanying the submission.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
