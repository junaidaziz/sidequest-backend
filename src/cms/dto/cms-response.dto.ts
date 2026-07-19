import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CmsAnnouncementKind, CmsLinkPlacement, CmsSectionType, Prisma } from '@prisma/client';

/**
 * Admin-facing response DTOs — carry the full record including draft status and
 * audit timestamps. Asset keys are resolved to short-lived presigned URLs so the
 * admin editor can preview them.
 */

class CmsAdminBaseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['Draft', 'Published', 'Archived'] }) status!: string;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class CmsPageDto extends CmsAdminBaseDto {
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: Object }) body!: Prisma.JsonValue;
  @ApiProperty({ nullable: true }) metaTitle!: string | null;
  @ApiProperty({ nullable: true }) metaDescription!: string | null;
}

export class CmsSectionDto extends CmsAdminBaseDto {
  @ApiProperty() key!: string;
  @ApiProperty({ enum: CmsSectionType }) type!: CmsSectionType;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ type: Object }) data!: Prisma.JsonValue;
  @ApiProperty() sortOrder!: number;
}

export class CmsFaqDto extends CmsAdminBaseDto {
  @ApiProperty() question!: string;
  @ApiProperty() answer!: string;
  @ApiProperty({ nullable: true }) category!: string | null;
  @ApiProperty() sortOrder!: number;
}

export class CmsTestimonialDto extends CmsAdminBaseDto {
  @ApiProperty() authorName!: string;
  @ApiProperty({ nullable: true }) authorTitle!: string | null;
  @ApiProperty() quote!: string;
  @ApiProperty({ nullable: true }) avatarKey!: string | null;
  @ApiProperty({ nullable: true, description: 'Presigned preview URL for avatarKey' })
  avatarUrl!: string | null;
  @ApiProperty({ nullable: true }) rating!: number | null;
  @ApiProperty() sortOrder!: number;
}

export class CmsScreenshotDto extends CmsAdminBaseDto {
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty() imageKey!: string;
  @ApiProperty({ nullable: true, description: 'Presigned preview URL for imageKey' })
  imageUrl!: string | null;
  @ApiProperty() sortOrder!: number;
}

export class CmsAnnouncementDto extends CmsAdminBaseDto {
  @ApiProperty({ enum: CmsAnnouncementKind }) kind!: CmsAnnouncementKind;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) excerpt!: string | null;
  @ApiProperty({ type: Object }) body!: Prisma.JsonValue;
  @ApiProperty({ nullable: true }) coverImageKey!: string | null;
  @ApiProperty({ nullable: true, description: 'Presigned preview URL for coverImageKey' })
  coverImageUrl!: string | null;
}

export class CmsLinkDto extends CmsAdminBaseDto {
  @ApiProperty({ enum: CmsLinkPlacement }) placement!: CmsLinkPlacement;
  @ApiProperty() label!: string;
  @ApiProperty() url!: string;
  @ApiProperty() openInNewTab!: boolean;
  @ApiProperty() sortOrder!: number;
}

// --------------------------------------------------------------------------
// Public response DTOs — lean, published-only, no draft/audit metadata.
// --------------------------------------------------------------------------

export class PublicPageDto {
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: Object }) body!: Prisma.JsonValue;
  @ApiPropertyOptional({ nullable: true }) metaTitle!: string | null;
  @ApiPropertyOptional({ nullable: true }) metaDescription!: string | null;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
}

export class PublicSectionDto {
  @ApiProperty() key!: string;
  @ApiProperty({ enum: CmsSectionType }) type!: CmsSectionType;
  @ApiPropertyOptional({ nullable: true }) title!: string | null;
  @ApiProperty({ type: Object }) data!: Prisma.JsonValue;
  @ApiProperty() sortOrder!: number;
}

export class PublicFaqDto {
  @ApiProperty() id!: string;
  @ApiProperty() question!: string;
  @ApiProperty() answer!: string;
  @ApiPropertyOptional({ nullable: true }) category!: string | null;
  @ApiProperty() sortOrder!: number;
}

export class PublicTestimonialDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorName!: string;
  @ApiPropertyOptional({ nullable: true }) authorTitle!: string | null;
  @ApiProperty() quote!: string;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) rating!: number | null;
  @ApiProperty() sortOrder!: number;
}

export class PublicScreenshotDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) title!: string | null;
  @ApiPropertyOptional({ nullable: true }) caption!: string | null;
  @ApiProperty({ nullable: true }) imageUrl!: string | null;
  @ApiProperty() sortOrder!: number;
}

export class PublicAnnouncementDto {
  @ApiProperty({ enum: CmsAnnouncementKind }) kind!: CmsAnnouncementKind;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) excerpt!: string | null;
  @ApiProperty({ type: Object }) body!: Prisma.JsonValue;
  @ApiPropertyOptional({ nullable: true }) coverImageUrl!: string | null;
  @ApiProperty({ nullable: true }) publishedAt!: Date | null;
}

export class PublicLinkDto {
  @ApiProperty({ enum: CmsLinkPlacement }) placement!: CmsLinkPlacement;
  @ApiProperty() label!: string;
  @ApiProperty() url!: string;
  @ApiProperty() openInNewTab!: boolean;
  @ApiProperty() sortOrder!: number;
}
