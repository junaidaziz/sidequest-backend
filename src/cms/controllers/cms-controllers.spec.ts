import { BadRequestException } from '@nestjs/common';
import { AuthAdmin } from '../../admin-auth/types/admin-jwt-payload.interface';
import { CmsAnnouncementController } from './cms-announcement.controller';
import { CmsFaqController } from './cms-faq.controller';
import { CmsLinkController } from './cms-link.controller';
import { CmsPageController } from './cms-page.controller';
import { CmsPublicController } from './cms-public.controller';
import { CmsScreenshotController } from './cms-screenshot.controller';
import { CmsSectionController } from './cms-section.controller';
import { CmsTestimonialController } from './cms-testimonial.controller';
import {
  buildCtx,
  cmsImageFileFilter,
  CMS_IMAGE_UPLOAD_OPTIONS,
  requireFile,
} from './cms-controller.util';

const actor = { adminUserId: 'admin-1' } as AuthAdmin;
const file = { mimetype: 'image/png', buffer: Buffer.from('x') } as Express.Multer.File;

function anyServiceMock(): Record<string, jest.Mock> {
  return new Proxy(
    {},
    {
      get: (target: Record<string, jest.Mock>, prop: string) => {
        if (!target[prop]) {
          target[prop] = jest.fn().mockResolvedValue({ ok: true });
        }
        return target[prop];
      },
    },
  );
}

describe('cms-controller.util', () => {
  it('buildCtx normalizes user agent', () => {
    expect(buildCtx('1.1.1.1', 'ua')).toEqual({ ipAddress: '1.1.1.1', userAgent: 'ua' });
    expect(buildCtx('1.1.1.1')).toEqual({ ipAddress: '1.1.1.1', userAgent: null });
  });

  it('cmsImageFileFilter accepts CMS image types and rejects others', () => {
    const accept = jest.fn();
    cmsImageFileFilter(null, { mimetype: 'image/svg+xml' } as Express.Multer.File, accept);
    expect(accept).toHaveBeenCalledWith(null, true);
    const reject = jest.fn();
    cmsImageFileFilter(null, { mimetype: 'application/pdf' } as Express.Multer.File, reject);
    expect(reject.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
    expect(reject.mock.calls[0][1]).toBe(false);
  });

  it('requireFile returns the file or throws', () => {
    expect(requireFile(file)).toBe(file);
    expect(() => requireFile(undefined)).toThrow(BadRequestException);
  });

  it('exposes upload options', () => {
    expect(CMS_IMAGE_UPLOAD_OPTIONS.limits.files).toBe(1);
  });
});

describe('CMS admin controllers delegate to their services', () => {
  it('CmsPageController', async () => {
    const s = anyServiceMock();
    const c = new CmsPageController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, { slug: 'a' } as never, '1.1.1.1', 'ua');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.setPublished).toHaveBeenCalledWith(actor, 'id', false, expect.any(Object));
  });

  it('CmsSectionController incl. reorder', async () => {
    const s = anyServiceMock();
    const c = new CmsSectionController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, {} as never, '1.1.1.1');
    await c.reorder(actor, { orderedIds: ['a'] } as never, '1.1.1.1');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.reorder).toHaveBeenCalledWith(actor, ['a'], expect.any(Object));
  });

  it('CmsFaqController', async () => {
    const s = anyServiceMock();
    const c = new CmsFaqController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, {} as never, '1.1.1.1');
    await c.reorder(actor, { orderedIds: ['a'] } as never, '1.1.1.1');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.create).toHaveBeenCalled();
  });

  it('CmsLinkController', async () => {
    const s = anyServiceMock();
    const c = new CmsLinkController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, {} as never, '1.1.1.1');
    await c.reorder(actor, { orderedIds: ['a'] } as never, '1.1.1.1');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.list).toHaveBeenCalled();
  });

  it('CmsTestimonialController incl. avatar upload', async () => {
    const s = anyServiceMock();
    const c = new CmsTestimonialController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, {} as never, '1.1.1.1');
    await c.reorder(actor, { orderedIds: ['a'] } as never, '1.1.1.1');
    await c.setAvatar(actor, 'id', file, '1.1.1.1');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.setAvatar).toHaveBeenCalledWith(actor, 'id', file, expect.any(Object));
    expect(() => c.setAvatar(actor, 'id', undefined, '1.1.1.1')).toThrow(BadRequestException);
  });

  it('CmsScreenshotController incl. image create/replace', async () => {
    const s = anyServiceMock();
    const c = new CmsScreenshotController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, {} as never, file, '1.1.1.1');
    await c.reorder(actor, { orderedIds: ['a'] } as never, '1.1.1.1');
    await c.replaceImage(actor, 'id', file, '1.1.1.1');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.createWithImage).toHaveBeenCalledWith(actor, {}, file, expect.any(Object));
    expect(() => c.create(actor, {} as never, undefined, '1.1.1.1')).toThrow(BadRequestException);
  });

  it('CmsAnnouncementController incl. cover upload', async () => {
    const s = anyServiceMock();
    const c = new CmsAnnouncementController(s as never);
    await c.list();
    await c.get('id');
    await c.create(actor, {} as never, '1.1.1.1');
    await c.setCover(actor, 'id', file, '1.1.1.1');
    await c.update(actor, 'id', {} as never, '1.1.1.1');
    await c.remove(actor, 'id', '1.1.1.1');
    await c.publish(actor, 'id', '1.1.1.1');
    await c.unpublish(actor, 'id', '1.1.1.1');
    expect(s.setCover).toHaveBeenCalledWith(actor, 'id', file, expect.any(Object));
  });
});

describe('CmsPublicController delegates to the public service', () => {
  it('routes each public read', async () => {
    const s = anyServiceMock();
    const c = new CmsPublicController(s as never);
    await c.getPage('about');
    await c.getSections();
    await c.getFaqs();
    await c.getTestimonials();
    await c.getScreenshots();
    await c.getAnnouncements({ kind: undefined });
    await c.getAnnouncement('slug');
    await c.getLinks({ placement: undefined });
    expect(s.getPageBySlug).toHaveBeenCalledWith('about');
    expect(s.getAnnouncementBySlug).toHaveBeenCalledWith('slug');
  });
});
