import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CmsAnnouncement,
  CmsAnnouncementKind,
  CmsFaq,
  CmsLink,
  CmsLinkPlacement,
  CmsPage,
  CmsScreenshot,
  CmsSection,
  CmsTestimonial,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CMS_CACHE_TAGS } from '../cms.constants';
import {
  PublicAnnouncementDto,
  PublicFaqDto,
  PublicLinkDto,
  PublicPageDto,
  PublicScreenshotDto,
  PublicSectionDto,
  PublicTestimonialDto,
} from '../dto/cms-response.dto';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';

const PUBLISHED = 'Published';

/**
 * Unauthenticated, cached read surface for the public Next.js site. Only ever
 * returns Published, non-deleted content. Each read is served from Redis when
 * warm (raw DB rows are cached; short-lived presigned asset URLs are re-signed
 * per response after the cache read, never cached). The cache is best-effort —
 * a Redis outage transparently falls through to Postgres.
 */
@Injectable()
export class CmsPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CmsCacheService,
    private readonly assets: CmsAssetService,
  ) {}

  private toDate(value: Date | string | null): Date | null {
    return value ? new Date(value) : null;
  }

  // ---- Pages -------------------------------------------------------------

  async getPageBySlug(slug: string): Promise<PublicPageDto> {
    const pages = await this.cachedList<CmsPage>(CMS_CACHE_TAGS.pages, () =>
      this.prisma.cmsPage.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: { slug: 'asc' },
      }),
    );
    const page = pages.find((p) => p.slug === slug);
    if (!page) {
      throw new NotFoundException('Page not found');
    }
    return {
      slug: page.slug,
      title: page.title,
      body: page.body,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      publishedAt: this.toDate(page.publishedAt),
    };
  }

  // ---- Sections ----------------------------------------------------------

  async getSections(): Promise<PublicSectionDto[]> {
    const sections = await this.cachedList<CmsSection>(CMS_CACHE_TAGS.sections, () =>
      this.prisma.cmsSection.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return sections.map((s) => ({
      key: s.key,
      type: s.type,
      title: s.title,
      data: s.data,
      sortOrder: s.sortOrder,
    }));
  }

  // ---- FAQs --------------------------------------------------------------

  async getFaqs(): Promise<PublicFaqDto[]> {
    const faqs = await this.cachedList<CmsFaq>(CMS_CACHE_TAGS.faqs, () =>
      this.prisma.cmsFaq.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return faqs.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      category: f.category,
      sortOrder: f.sortOrder,
    }));
  }

  // ---- Testimonials ------------------------------------------------------

  async getTestimonials(): Promise<PublicTestimonialDto[]> {
    const rows = await this.cachedList<CmsTestimonial>(CMS_CACHE_TAGS.testimonials, () =>
      this.prisma.cmsTestimonial.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return Promise.all(
      rows.map(async (t) => ({
        id: t.id,
        authorName: t.authorName,
        authorTitle: t.authorTitle,
        quote: t.quote,
        avatarUrl: await this.assets.resolveUrl(t.avatarKey),
        rating: t.rating,
        sortOrder: t.sortOrder,
      })),
    );
  }

  // ---- Screenshots -------------------------------------------------------

  async getScreenshots(): Promise<PublicScreenshotDto[]> {
    const rows = await this.cachedList<CmsScreenshot>(CMS_CACHE_TAGS.screenshots, () =>
      this.prisma.cmsScreenshot.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    return Promise.all(
      rows.map(async (s) => ({
        id: s.id,
        title: s.title,
        caption: s.caption,
        imageUrl: await this.assets.resolveUrl(s.imageKey),
        sortOrder: s.sortOrder,
      })),
    );
  }

  // ---- Announcements -----------------------------------------------------

  async getAnnouncements(kind?: CmsAnnouncementKind): Promise<PublicAnnouncementDto[]> {
    const rows = await this.cachedList<CmsAnnouncement>(CMS_CACHE_TAGS.announcements, () =>
      this.prisma.cmsAnnouncement.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      }),
    );
    const filtered = kind ? rows.filter((a) => a.kind === kind) : rows;
    return Promise.all(filtered.map((a) => this.toPublicAnnouncement(a)));
  }

  async getAnnouncementBySlug(slug: string): Promise<PublicAnnouncementDto> {
    const rows = await this.cachedList<CmsAnnouncement>(CMS_CACHE_TAGS.announcements, () =>
      this.prisma.cmsAnnouncement.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      }),
    );
    const found = rows.find((a) => a.slug === slug);
    if (!found) {
      throw new NotFoundException('Announcement not found');
    }
    return this.toPublicAnnouncement(found);
  }

  private async toPublicAnnouncement(a: CmsAnnouncement): Promise<PublicAnnouncementDto> {
    return {
      kind: a.kind,
      slug: a.slug,
      title: a.title,
      excerpt: a.excerpt,
      body: a.body,
      coverImageUrl: await this.assets.resolveUrl(a.coverImageKey),
      publishedAt: this.toDate(a.publishedAt),
    };
  }

  // ---- Links -------------------------------------------------------------

  async getLinks(placement?: CmsLinkPlacement): Promise<PublicLinkDto[]> {
    const rows = await this.cachedList<CmsLink>(CMS_CACHE_TAGS.links, () =>
      this.prisma.cmsLink.findMany({
        where: { status: PUBLISHED, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
    const filtered = placement ? rows.filter((l) => l.placement === placement) : rows;
    return filtered.map((l) => ({
      placement: l.placement,
      label: l.label,
      url: l.url,
      openInNewTab: l.openInNewTab,
      sortOrder: l.sortOrder,
    }));
  }

  /**
   * Serves a published list from Redis when warm, otherwise reads Postgres and
   * warms the cache. Best-effort throughout — never fails a public read on a
   * cache miss or Redis error.
   */
  private async cachedList<T>(
    tag: (typeof CMS_CACHE_TAGS)[keyof typeof CMS_CACHE_TAGS],
    fetch: () => Promise<T[]>,
  ): Promise<T[]> {
    const cached = await this.cache.get<T[]>(tag);
    if (cached) {
      return cached;
    }
    const rows = await fetch();
    await this.cache.set(tag, rows);
    return rows;
  }
}
