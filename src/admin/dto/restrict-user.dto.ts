import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { RestrictableFeature } from '../admin-users.constants';

/**
 * Body for `PATCH /admin/users/:id/restrict`. Sets the user's restriction list to
 * exactly `features` (replace semantics) — an empty array clears all
 * restrictions. Only keys in the known `RestrictableFeature` allow-list are
 * accepted; anything else is a 400. A reason is required so the operator's intent
 * is captured in the audit log.
 */
export class RestrictUserDto {
  @ApiProperty({
    description:
      'The complete set of feature restrictions to apply (replaces any existing set). Empty array clears all.',
    enum: RestrictableFeature,
    isArray: true,
    example: [RestrictableFeature.ProofSubmission],
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(RestrictableFeature, { each: true })
  features!: RestrictableFeature[];

  @ApiProperty({
    description: 'Operator reason for the restriction change',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
