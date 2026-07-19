import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PublicAnnouncementDto,
  PublicFaqDto,
  PublicLinkDto,
  PublicPageDto,
  PublicScreenshotDto,
  PublicSectionDto,
  PublicTestimonialDto,
} from '../dto/cms-response.dto';
import { PublicAnnouncementQueryDto, PublicLinkQueryDto } from '../dto/public-query.dto';
import { CmsPublicService } from '../services/cms-public.service';

/**
 * Unauthenticated, cached read surface consumed by the public Next.js site's
 * server components. Only Published, non-deleted content is ever returned.
 */
@ApiTags('cms-public')
@Controller('cms')
export class CmsPublicController {
  constructor(private readonly service: CmsPublicService) {}

  @Get('pages/:slug')
  @ApiOperation({ summary: 'Get a published page by slug' })
  getPage(@Param('slug') slug: string): Promise<PublicPageDto> {
    return this.service.getPageBySlug(slug);
  }

  @Get('sections')
  @ApiOperation({ summary: 'List published homepage/feature sections' })
  getSections(): Promise<PublicSectionDto[]> {
    return this.service.getSections();
  }

  @Get('faqs')
  @ApiOperation({ summary: 'List published FAQs' })
  getFaqs(): Promise<PublicFaqDto[]> {
    return this.service.getFaqs();
  }

  @Get('testimonials')
  @ApiOperation({ summary: 'List published testimonials' })
  getTestimonials(): Promise<PublicTestimonialDto[]> {
    return this.service.getTestimonials();
  }

  @Get('screenshots')
  @ApiOperation({ summary: 'List published app screenshots' })
  getScreenshots(): Promise<PublicScreenshotDto[]> {
    return this.service.getScreenshots();
  }

  @Get('announcements')
  @ApiOperation({ summary: 'List published announcements (optionally filtered by kind)' })
  getAnnouncements(@Query() query: PublicAnnouncementQueryDto): Promise<PublicAnnouncementDto[]> {
    return this.service.getAnnouncements(query.kind);
  }

  @Get('announcements/:slug')
  @ApiOperation({ summary: 'Get a published announcement by slug' })
  getAnnouncement(@Param('slug') slug: string): Promise<PublicAnnouncementDto> {
    return this.service.getAnnouncementBySlug(slug);
  }

  @Get('links')
  @ApiOperation({ summary: 'List published nav/footer links (optionally filtered by placement)' })
  getLinks(@Query() query: PublicLinkQueryDto): Promise<PublicLinkDto[]> {
    return this.service.getLinks(query.placement);
  }
}
