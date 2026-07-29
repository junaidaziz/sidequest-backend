import { ApiProperty } from '@nestjs/swagger';
import { MissionTag, MissionTagType } from '@prisma/client';

/** Public-safe view of a MissionTag row. */
export class MissionTagDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: MissionTagType })
  type!: MissionTagType;

  @ApiProperty({ example: 'Solo' })
  value!: string;

  @ApiProperty({ example: 'Solo' })
  label!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(tag: MissionTag): MissionTagDto {
    return {
      id: tag.id,
      type: tag.type,
      value: tag.value,
      label: tag.label,
      isActive: tag.isActive,
      sortOrder: tag.sortOrder,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    };
  }
}

/** List response — a flat array plus a total, matching the simple-list convention. */
export class MissionTagListDto {
  @ApiProperty({ type: [MissionTagDto] })
  items!: MissionTagDto[];

  @ApiProperty({ description: 'Number of tags returned.' })
  total!: number;
}
