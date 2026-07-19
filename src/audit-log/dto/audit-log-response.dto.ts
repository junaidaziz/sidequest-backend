import { ApiProperty } from '@nestjs/swagger';

/** A single audit entry, read-only. */
export class AuditLogEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, description: 'Acting admin id; null for system events' })
  adminUserId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty({ nullable: true })
  targetType!: string | null;

  @ApiProperty({ nullable: true })
  targetId!: string | null;

  @ApiProperty({ nullable: true, description: 'Before-snapshot JSON' })
  previousValue!: unknown;

  @ApiProperty({
    nullable: true,
    description: 'After-snapshot JSON; carries reserved __result/__reason keys',
  })
  newValue!: unknown;

  @ApiProperty({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ nullable: true })
  userAgent!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

/** Paginated audit-log page. */
export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogEntryDto] })
  items!: AuditLogEntryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
