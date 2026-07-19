import { CmsSectionType } from '@prisma/client';
import { validate } from 'class-validator';
import { CreateCmsSectionDto } from '../dto/cms-content.dto';
import { plainToInstance } from 'class-transformer';
import { IsValidSectionDataConstraint } from './section-data.validator';

function makeArgs(type: CmsSectionType | undefined): { object: { type?: CmsSectionType } } {
  return { object: { type } };
}

describe('IsValidSectionDataConstraint', () => {
  const c = new IsValidSectionDataConstraint();

  it('accepts a valid Hero payload', () => {
    const ok = c.validate(
      { headline: 'Welcome', ctaHref: '/download' },
      makeArgs(CmsSectionType.Hero) as never,
    );
    expect(ok).toBe(true);
  });

  it('rejects a Hero payload with a javascript: CTA href', () => {
    const ok = c.validate(
      { headline: 'x', ctaHref: 'javascript:alert(1)' },
      makeArgs(CmsSectionType.Hero) as never,
    );
    expect(ok).toBe(false);
    expect(c.defaultMessage()).toContain('data invalid');
  });

  it('rejects a Hero payload missing the required headline', () => {
    const ok = c.validate({ subheadline: 'x' }, makeArgs(CmsSectionType.Hero) as never);
    expect(ok).toBe(false);
  });

  it('rejects unknown/extraneous keys (forbidNonWhitelisted)', () => {
    const ok = c.validate(
      { headline: 'x', evil: '<script>' },
      makeArgs(CmsSectionType.Hero) as never,
    );
    expect(ok).toBe(false);
  });

  it('requires `type` to validate data', () => {
    const ok = c.validate({ headline: 'x' }, makeArgs(undefined) as never);
    expect(ok).toBe(false);
    expect(c.defaultMessage()).toContain('type is required');
  });

  it('rejects non-object data', () => {
    expect(c.validate('nope', makeArgs(CmsSectionType.Hero) as never)).toBe(false);
    expect(c.validate(['a'], makeArgs(CmsSectionType.Hero) as never)).toBe(false);
    expect(c.validate(null, makeArgs(CmsSectionType.Hero) as never)).toBe(false);
  });

  it('validates a Feature payload with nested items', () => {
    const ok = c.validate(
      { items: [{ title: 'A', description: 'B' }] },
      makeArgs(CmsSectionType.Feature) as never,
    );
    expect(ok).toBe(true);
  });

  it('rejects a Feature item missing a required field', () => {
    const ok = c.validate({ items: [{ title: 'A' }] }, makeArgs(CmsSectionType.Feature) as never);
    expect(ok).toBe(false);
  });

  it('validates a Custom section of structured blocks (no freeform HTML)', () => {
    const ok = c.validate(
      {
        blocks: [
          { kind: 'paragraph', text: 'hello' },
          { kind: 'heading', text: 'Hi', level: 2 },
        ],
      },
      makeArgs(CmsSectionType.Custom) as never,
    );
    expect(ok).toBe(true);
  });

  it('validates FAQ/Testimonial reference sections', () => {
    expect(
      c.validate(
        { faqIds: ['11111111-1111-4111-8111-111111111111'] },
        makeArgs(CmsSectionType.Faq) as never,
      ),
    ).toBe(true);
    expect(
      c.validate(
        { testimonialIds: ['not-a-uuid'] },
        makeArgs(CmsSectionType.Testimonials) as never,
      ),
    ).toBe(false);
  });
});

describe('CreateCmsSectionDto integration', () => {
  it('passes validation end-to-end for a valid Stats section', async () => {
    const dto = plainToInstance(CreateCmsSectionDto, {
      key: 'home.stats',
      type: CmsSectionType.Stats,
      data: { stats: [{ label: 'Users', value: '10k' }] },
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation when data does not match the declared type', async () => {
    const dto = plainToInstance(CreateCmsSectionDto, {
      key: 'home.stats',
      type: CmsSectionType.Stats,
      data: { headline: 'wrong shape' },
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a malformed section key', async () => {
    const dto = plainToInstance(CreateCmsSectionDto, {
      key: 'Home Hero!',
      type: CmsSectionType.Hero,
      data: { headline: 'x' },
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'key')).toBe(true);
  });
});
