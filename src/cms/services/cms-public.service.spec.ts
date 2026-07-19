import { NotFoundException } from '@nestjs/common';
import { CmsAnnouncementKind, CmsLinkPlacement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CmsAssetService } from './cms-asset.service';
import { CmsCacheService } from './cms-cache.service';
import { CmsPublicService } from './cms-public.service';

describe('CmsPublicService', () => {
  let prisma: {
    cmsPage: { findMany: jest.Mock };
    cmsSection: { findMany: jest.Mock };
    cmsFaq: { findMany: jest.Mock };
    cmsTestimonial: { findMany: jest.Mock };
    cmsScreenshot: { findMany: jest.Mock };
    cmsAnnouncement: { findMany: jest.Mock };
    cmsLink: { findMany: jest.Mock };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let assets: { resolveUrl: jest.Mock };
  let service: CmsPublicService;

  beforeEach(() => {
    prisma = {
      cmsPage: { findMany: jest.fn() },
      cmsSection: { findMany: jest.fn() },
      cmsFaq: { findMany: jest.fn() },
      cmsTestimonial: { findMany: jest.fn() },
      cmsScreenshot: { findMany: jest.fn() },
      cmsAnnouncement: { findMany: jest.fn() },
      cmsLink: { findMany: jest.fn() },
    };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
    assets = { resolveUrl: jest.fn().mockResolvedValue('https://signed/x') };
    service = new CmsPublicService(
      prisma as unknown as PrismaService,
      cache as unknown as CmsCacheService,
      assets as unknown as CmsAssetService,
    );
  });

  it('reads Postgres on a cache miss and warms the cache', async () => {
    prisma.cmsFaq.findMany.mockResolvedValue([
      { id: 'f1', question: 'Q', answer: 'A', category: null, sortOrder: 0 },
    ]);
    const out = await service.getFaqs();
    expect(out).toHaveLength(1);
    expect(prisma.cmsFaq.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'Published', deletedAt: null } }),
    );
    expect(cache.set).toHaveBeenCalledWith('faqs', expect.any(Array));
  });

  it('serves from cache without touching Postgres on a hit', async () => {
    cache.get.mockResolvedValue([
      { id: 'f1', question: 'Q', answer: 'A', category: null, sortOrder: 0 },
    ]);
    const out = await service.getFaqs();
    expect(out).toHaveLength(1);
    expect(prisma.cmsFaq.findMany).not.toHaveBeenCalled();
  });

  it('gets a page by slug', async () => {
    prisma.cmsPage.findMany.mockResolvedValue([
      {
        slug: 'about',
        title: 'About',
        body: {},
        metaTitle: null,
        metaDescription: null,
        publishedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    const page = await service.getPageBySlug('about');
    expect(page.title).toBe('About');
    expect(page.publishedAt).toBeInstanceOf(Date);
  });

  it('404s an unknown page slug', async () => {
    prisma.cmsPage.findMany.mockResolvedValue([]);
    await expect(service.getPageBySlug('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists sections mapped to the lean public shape', async () => {
    prisma.cmsSection.findMany.mockResolvedValue([
      { key: 'home.hero', type: 'Hero', title: null, data: { headline: 'Hi' }, sortOrder: 0 },
    ]);
    const out = await service.getSections();
    expect(out[0]).toEqual({
      key: 'home.hero',
      type: 'Hero',
      title: null,
      data: { headline: 'Hi' },
      sortOrder: 0,
    });
  });

  it('resolves testimonial + screenshot asset URLs', async () => {
    prisma.cmsTestimonial.findMany.mockResolvedValue([
      {
        id: 't1',
        authorName: 'S',
        authorTitle: null,
        quote: 'Q',
        avatarKey: 'k',
        rating: null,
        sortOrder: 0,
      },
    ]);
    prisma.cmsScreenshot.findMany.mockResolvedValue([
      { id: 's1', title: null, caption: null, imageKey: 'k', sortOrder: 0 },
    ]);
    expect((await service.getTestimonials())[0].avatarUrl).toBe('https://signed/x');
    expect((await service.getScreenshots())[0].imageUrl).toBe('https://signed/x');
  });

  it('filters announcements by kind and resolves cover URLs', async () => {
    prisma.cmsAnnouncement.findMany.mockResolvedValue([
      {
        kind: 'Blog',
        slug: 'a',
        title: 'A',
        excerpt: null,
        body: {},
        coverImageKey: 'k',
        publishedAt: null,
      },
      {
        kind: 'SafetyNotice',
        slug: 'b',
        title: 'B',
        excerpt: null,
        body: {},
        coverImageKey: null,
        publishedAt: null,
      },
    ]);
    const blogs = await service.getAnnouncements(CmsAnnouncementKind.Blog);
    expect(blogs).toHaveLength(1);
    expect(blogs[0].slug).toBe('a');
    expect(blogs[0].coverImageUrl).toBe('https://signed/x');
  });

  it('gets an announcement by slug (and 404s otherwise)', async () => {
    prisma.cmsAnnouncement.findMany.mockResolvedValue([
      {
        kind: 'Blog',
        slug: 'a',
        title: 'A',
        excerpt: null,
        body: {},
        coverImageKey: null,
        publishedAt: null,
      },
    ]);
    expect((await service.getAnnouncementBySlug('a')).title).toBe('A');
    await expect(service.getAnnouncementBySlug('z')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters links by placement', async () => {
    prisma.cmsLink.findMany.mockResolvedValue([
      { placement: 'Nav', label: 'Home', url: '/', openInNewTab: false, sortOrder: 0 },
      { placement: 'Footer', label: 'Privacy', url: '/p', openInNewTab: false, sortOrder: 0 },
    ]);
    const nav = await service.getLinks(CmsLinkPlacement.Nav);
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe('Home');
  });
});
