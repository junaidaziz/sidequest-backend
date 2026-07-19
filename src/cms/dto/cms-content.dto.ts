import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CmsAnnouncementKind, CmsLinkPlacement, CmsSectionType } from '@prisma/client';
import { IsContentSlug, IsSafeHref, RichContentDto } from './common.dto';
import { IsValidSectionData } from '../validators/section-data.validator';

// --------------------------------------------------------------------------
// CmsPage
// --------------------------------------------------------------------------

export class CreateCmsPageDto {
  @ApiProperty({ description: 'Unique url slug (lowercase-hyphenated)' })
  @IsContentSlug()
  slug!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ type: RichContentDto, description: 'Structured body (never freeform HTML)' })
  @ValidateNested()
  @Type(() => RichContentDto)
  body!: RichContentDto;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaTitle?: string;

  @ApiPropertyOptional({ maxLength: 320 })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  metaDescription?: string;
}

export class UpdateCmsPageDto extends PartialType(CreateCmsPageDto) {}

// --------------------------------------------------------------------------
// CmsSection
// --------------------------------------------------------------------------

export class CreateCmsSectionDto {
  @ApiProperty({ description: 'Stable slot key (e.g. "home.hero")' })
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, {
    message: 'key must be lowercase alphanumeric segments separated by "." or "-"',
  })
  key!: string;

  @ApiProperty({ enum: CmsSectionType })
  @IsEnum(CmsSectionType)
  type!: CmsSectionType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({
    description: 'Structured payload validated per `type` — never freeform JSON',
    type: Object,
  })
  @IsValidSectionData()
  data!: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateCmsSectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
  key?: string;

  @ApiPropertyOptional({ enum: CmsSectionType })
  @IsOptional()
  @IsEnum(CmsSectionType)
  type?: CmsSectionType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Requires `type` to also be present when supplied' })
  @IsOptional()
  @ValidateIf((o: UpdateCmsSectionDto) => o.data !== undefined)
  @IsValidSectionData()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

// --------------------------------------------------------------------------
// CmsFaq
// --------------------------------------------------------------------------

export class CreateCmsFaqDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  answer!: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateCmsFaqDto extends PartialType(CreateCmsFaqDto) {}

// --------------------------------------------------------------------------
// CmsTestimonial
// --------------------------------------------------------------------------

export class CreateCmsTestimonialDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  authorName!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorTitle?: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  quote!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateCmsTestimonialDto extends PartialType(CreateCmsTestimonialDto) {}

// --------------------------------------------------------------------------
// CmsScreenshot (metadata; the image itself is a multipart field on create/replace)
// --------------------------------------------------------------------------

export class CreateCmsScreenshotDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateCmsScreenshotDto extends PartialType(CreateCmsScreenshotDto) {}

// --------------------------------------------------------------------------
// CmsAnnouncement
// --------------------------------------------------------------------------

export class CreateCmsAnnouncementDto {
  @ApiProperty({ enum: CmsAnnouncementKind })
  @IsEnum(CmsAnnouncementKind)
  kind!: CmsAnnouncementKind;

  @ApiProperty()
  @IsContentSlug()
  slug!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ApiProperty({ type: RichContentDto })
  @ValidateNested()
  @Type(() => RichContentDto)
  body!: RichContentDto;
}

export class UpdateCmsAnnouncementDto extends PartialType(CreateCmsAnnouncementDto) {}

// --------------------------------------------------------------------------
// CmsLink
// --------------------------------------------------------------------------

export class CreateCmsLinkDto {
  @ApiProperty({ enum: CmsLinkPlacement })
  @IsEnum(CmsLinkPlacement)
  placement!: CmsLinkPlacement;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ description: 'Safe href' })
  @IsSafeHref()
  url!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  openInNewTab?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateCmsLinkDto extends PartialType(CreateCmsLinkDto) {}
