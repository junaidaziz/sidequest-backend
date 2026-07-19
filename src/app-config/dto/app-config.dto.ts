import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';

/** Create-or-update payload for a single AppConfig key. */
export class UpsertAppConfigDto {
  @ApiProperty({
    type: Object,
    description: 'Arbitrary JSON value (scalar, object or array). Must be present.',
  })
  @IsDefined()
  value!: Prisma.InputJsonValue;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/** Admin-facing AppConfig entry. */
export class AppConfigDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty({ type: Object }) value!: Prisma.JsonValue;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Whether this key is exposed on the public config endpoint' })
  isPublic!: boolean;
  @ApiProperty() updatedAt!: Date;
}

/** Public config response — a flat `{ key: value }` map of allow-listed keys. */
export class PublicAppConfigDto {
  @ApiProperty({
    type: Object,
    description: 'Map of public config keys to their JSON values',
  })
  config!: Record<string, Prisma.JsonValue>;
}
