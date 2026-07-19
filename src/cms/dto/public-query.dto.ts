import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CmsAnnouncementKind, CmsLinkPlacement } from '@prisma/client';

export class PublicAnnouncementQueryDto {
  @ApiPropertyOptional({ enum: CmsAnnouncementKind })
  @IsOptional()
  @IsEnum(CmsAnnouncementKind)
  kind?: CmsAnnouncementKind;
}

export class PublicLinkQueryDto {
  @ApiPropertyOptional({ enum: CmsLinkPlacement })
  @IsOptional()
  @IsEnum(CmsLinkPlacement)
  placement?: CmsLinkPlacement;
}
