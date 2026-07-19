import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserAccountStatus } from '../admin-users.constants';

/**
 * Coerces the common truthy/falsy query-string encodings into a real boolean so
 * `?hasChallengeParticipation=false` is respected (a bare `Boolean('false')` is
 * `true`). Anything else is left untouched for the validator to reject.
 */
function toOptionalBoolean(value: unknown): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

/**
 * Filters for `GET /admin/users`. Every field is optional and — critically —
 * only filters on columns that actually exist on the `User` table. The spec also
 * asks for country / platform / profile-privacy filters; those have no backing
 * data on `User` today and are deliberately NOT faked here (documented gaps in
 * the delivery report) rather than invented.
 */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: '1-based page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @ApiPropertyOptional({ description: 'Case-insensitive match on email or displayName' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    enum: UserAccountStatus,
    description: 'Derived account status (active | suspended | deleted)',
  })
  @IsOptional()
  @IsEnum(UserAccountStatus)
  status?: UserAccountStatus;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on registration date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  registeredFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on registration date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  registeredTo?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on last-completion date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  lastCompletionFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on last-completion date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  lastCompletionTo?: string;

  @ApiPropertyOptional({
    description:
      'When set, filters to users who have (true) / have not (false) participated in any challenge (UserTask)',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  hasChallengeParticipation?: boolean;

  @ApiPropertyOptional({ description: 'Filter by guest (true) vs full account (false)' })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isGuest?: boolean;
}
