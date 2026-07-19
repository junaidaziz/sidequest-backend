/**
 * Stable content-type identifiers used across the CMS module for three things at
 * once, keeping them impossible to drift apart:
 *  - the Redis public-cache key suffix (`cms:public:<tag>`),
 *  - the revalidation cache tag sent to the web app (`cms:<tag>`),
 *  - part of the audit `targetType` (paired with the Prisma model name).
 */
export const CMS_CACHE_TAGS = {
  pages: 'pages',
  sections: 'sections',
  faqs: 'faqs',
  testimonials: 'testimonials',
  screenshots: 'screenshots',
  announcements: 'announcements',
  links: 'links',
} as const;

export type CmsCacheTag = (typeof CMS_CACHE_TAGS)[keyof typeof CMS_CACHE_TAGS];

/** Redis key namespace for cached public reads. */
export const CMS_CACHE_KEY_PREFIX = 'cms:public:';

/** Revalidation tag namespace sent to the web app's /api/revalidate receiver. */
export const CMS_REVALIDATE_TAG_PREFIX = 'cms:';

/** Default public-read cache TTL — mirrors the plan's 300s ISR fallback. */
export const CMS_PUBLIC_CACHE_DEFAULT_TTL_SECONDS = 300;
