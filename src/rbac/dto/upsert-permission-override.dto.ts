import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionOverrideEffect } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Grants (GRANT) or revokes (REVOKE) a single catalog permission for one admin,
 * layered on top of their role's baseline. The target admin + permission are
 * identified by the URL (`:id` + `:permissionKey`); this body carries only the
 * effect and an optional audit reason. Applied as an upsert on the
 * `[adminUserId, permissionId]` unique constraint — a second call for the same
 * pair updates the existing row's effect rather than creating a duplicate.
 *
 * REVOKE actively subtracts the permission even when the role grants it; to
 * simply return to the role's baseline, DELETE the override instead (which
 * removes the row entirely — a different outcome from a REVOKE row).
 */
export class UpsertPermissionOverrideDto {
  @ApiProperty({
    enum: PermissionOverrideEffect,
    description: 'GRANT adds the permission; REVOKE removes it even if the role grants it',
  })
  @IsEnum(PermissionOverrideEffect)
  effect!: PermissionOverrideEffect;

  @ApiPropertyOptional({
    description: 'Optional human-readable justification, captured in the audit log',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
