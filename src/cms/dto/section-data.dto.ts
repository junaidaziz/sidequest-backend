import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CmsSectionType } from '@prisma/client';
import { ContentBlockDto, IsSafeHref } from './common.dto';

/**
 * Per-`CmsSectionType` payload schemas. The `CmsSection.data` Json column is
 * validated against exactly one of these based on the sibling `type` field (see
 * IsValidSectionDataConstraint) — never accepted as freeform JSON. This is the
 * explicit anti-arbitrary-markup-XSS design decision from the plan: the public
 * renderer for each section type reads a fixed, validated shape, so no admin can
 * smuggle raw markup or an active URL through `data`.
 */

class CtaFieldsDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ctaLabel?: string;

  @ApiPropertyOptional({ description: 'Safe href for the CTA' })
  @IsOptional()
  @IsSafeHref()
  ctaHref?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondaryCtaLabel?: string;

  @ApiPropertyOptional({ description: 'Safe href for the secondary CTA' })
  @IsOptional()
  @IsSafeHref()
  secondaryCtaHref?: string;
}

export class HeroSectionData extends CtaFieldsDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  headline!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subheadline?: string;

  @ApiPropertyOptional({ description: 'S3 object key for the hero image' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageKey?: string;
}

export class FeatureItemDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'Icon token/key' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  iconKey?: string;
}

export class FeatureSectionData {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @ApiProperty({ type: [FeatureItemDto] })
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => FeatureItemDto)
  items!: FeatureItemDto[];
}

export class HowItWorksStepDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ description: 'Icon token/key' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  iconKey?: string;
}

export class HowItWorksSectionData {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @ApiProperty({ type: [HowItWorksStepDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => HowItWorksStepDto)
  steps!: HowItWorksStepDto[];
}

export class StatItemDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  label!: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @MaxLength(40)
  value!: string;
}

export class StatsSectionData {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @ApiProperty({ type: [StatItemDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => StatItemDto)
  stats!: StatItemDto[];
}

export class TestimonialsSectionData {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @ApiPropertyOptional({ type: [String], description: 'Curated CmsTestimonial ids to feature' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsUUID('4', { each: true })
  testimonialIds?: string[];
}

export class FaqSectionData {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @ApiPropertyOptional({ type: [String], description: 'Curated CmsFaq ids to feature' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  faqIds?: string[];
}

export class CtaSectionData extends CtaFieldsDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  headline!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subheadline?: string;
}

export class CustomSectionData {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  heading?: string;

  @ApiProperty({ type: [ContentBlockDto], description: 'Structured blocks — never freeform HTML' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ContentBlockDto)
  blocks!: ContentBlockDto[];
}

/** Optional numeric ordering hint some section data payloads may carry. */
export class WeightHintDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  weight?: number;
}

/** Maps each section type to the class its `data` payload must satisfy. */
export const SECTION_DATA_CLASSES: Readonly<Record<CmsSectionType, new () => object>> = {
  [CmsSectionType.Hero]: HeroSectionData,
  [CmsSectionType.Feature]: FeatureSectionData,
  [CmsSectionType.HowItWorks]: HowItWorksSectionData,
  [CmsSectionType.Stats]: StatsSectionData,
  [CmsSectionType.Testimonials]: TestimonialsSectionData,
  [CmsSectionType.Faq]: FaqSectionData,
  [CmsSectionType.Cta]: CtaSectionData,
  [CmsSectionType.Custom]: CustomSectionData,
};
