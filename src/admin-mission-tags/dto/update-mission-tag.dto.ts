import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Edits a mission tag. `type` is intentionally NOT editable — changing a tag's
 * vocabulary would silently orphan any mission already referencing its value;
 * deactivate and create a new one instead. Every field is optional (partial
 * update); an omitted field is left untouched.
 */
export class UpdateMissionTagDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 50,
    description: 'Canonical value stored in Mission.crewTags/settingTags.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  value?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 50, description: 'Human-facing label.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Display order within the vocabulary.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Toggle active state (reactivate or deactivate).' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
