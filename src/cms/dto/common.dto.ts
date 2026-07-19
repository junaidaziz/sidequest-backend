import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Anchor/URL values we accept in managed content. Deliberately excludes
 * `javascript:`, `data:`, `vbscript:` and other active schemes — a link href is
 * another arbitrary-markup XSS surface, so it is allow-listed the same way SVG
 * bodies are. Permits absolute http(s), root-relative, anchor, mailto and tel.
 */
const SAFE_HREF = /^(?:https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i;

/** Reusable "safe href" property validator (string, bounded, scheme-allow-listed). */
export function IsSafeHref(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(2048),
    Matches(SAFE_HREF, {
      message: 'href must be an http(s), root-relative, anchor, mailto or tel link',
    }),
  );
}

/**
 * A single structured content block. This is the unit of long-form CMS body
 * content (CmsPage.body, CmsAnnouncement.body) and of Custom sections — chosen
 * over freeform HTML precisely so there is no arbitrary-markup XSS surface: the
 * public renderer maps each block to a fixed, safe component, never `dangerouslySetInnerHTML`.
 */
export class ContentBlockDto {
  @ApiProperty({ enum: ['heading', 'paragraph', 'quote', 'image', 'list'] })
  @IsIn(['heading', 'paragraph', 'quote', 'image', 'list'])
  kind!: 'heading' | 'paragraph' | 'quote' | 'image' | 'list';

  @ApiPropertyOptional({ description: 'Text for heading/paragraph/quote blocks' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 6, description: 'Heading level (h1–h6)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  level?: number;

  @ApiPropertyOptional({ description: 'S3 object key for an image block' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  imageKey?: string;

  @ApiPropertyOptional({ description: 'Alt text / caption for an image block' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;

  @ApiPropertyOptional({ type: [String], description: 'Items for a list block' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  items?: string[];
}

/** Structured long-form body: an ordered list of safe content blocks. */
export class RichContentDto {
  @ApiProperty({ type: [ContentBlockDto], description: 'Ordered structured content blocks' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ContentBlockDto)
  blocks!: ContentBlockDto[];
}

/** Payload for a drag-to-reorder request. */
export class ReorderDto {
  @ApiProperty({ type: [String], description: 'Item ids in the desired display order' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}

/** Bounded slug used by pages/announcements. Lowercase, hyphenated, url-safe. */
export function IsContentSlug(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(1),
    MaxLength(160),
    Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'slug must be lowercase alphanumeric words separated by single hyphens',
    }),
  );
}
