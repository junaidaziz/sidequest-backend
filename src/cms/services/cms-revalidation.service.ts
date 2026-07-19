import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CMS_REVALIDATE_TAG_PREFIX } from '../cms.constants';

/** How long to wait for the web app before abandoning a revalidation ping. */
const REVALIDATE_TIMEOUT_MS = 3000;

/**
 * Fires the web app's on-demand revalidation webhook after public-facing CMS
 * content changes, so the Next.js public site drops its cached copy immediately
 * instead of waiting out its time-based ISR fallback.
 *
 * This is a **best-effort side effect** and follows the codebase's established
 * "a side-effect failure must never fail the already-committed primary write"
 * convention (cf. VerificationQueueService.enqueueAutoApprove / the notification
 * enqueue calls): `trigger()` returns void, never throws, and swallows every
 * error after logging. If WEB_APP_URL / CMS_REVALIDATE_SECRET are unset (e.g.
 * local dev before the web app exists) it no-ops silently.
 *
 * Call shape (documented here so the Phase-7 frontend receiver can match it):
 *   POST {WEB_APP_URL}/api/revalidate
 *   headers: { 'content-type': 'application/json', 'x-revalidate-secret': <secret> }
 *   body:    { "tags": ["cms:faqs", "cms:sections", ...] }
 */
@Injectable()
export class CmsRevalidationService {
  private readonly logger = new Logger(CmsRevalidationService.name);
  private readonly webAppUrl?: string;
  private readonly secret?: string;

  constructor(config: ConfigService) {
    this.webAppUrl = config.get<string>('WEB_APP_URL')?.replace(/\/+$/, '');
    this.secret = config.get<string>('CMS_REVALIDATE_SECRET');
  }

  /**
   * Fire-and-forget revalidation for one or more cache tags. Tags are the bare
   * content-type tags (e.g. `cms:faqs`); an optional slug-specific tag can be
   * appended by the caller (e.g. `cms:pages`, `cms:page:about`).
   */
  trigger(tags: string[]): void {
    if (tags.length === 0) {
      return;
    }
    if (!this.webAppUrl || !this.secret) {
      this.logger.debug(
        `Skipping revalidation for [${tags.join(', ')}] — WEB_APP_URL/CMS_REVALIDATE_SECRET not configured`,
      );
      return;
    }
    void this.post(tags);
  }

  /** Convenience: build a slug-specific tag alongside the content-type tag. */
  static slugTag(cacheTag: string, slug: string): string {
    return `${CMS_REVALIDATE_TAG_PREFIX}${cacheTag}:${slug}`;
  }

  private async post(tags: string[]): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.webAppUrl}/api/revalidate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': this.secret as string,
        },
        body: JSON.stringify({ tags }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Revalidation webhook returned ${res.status} for [${tags.join(', ')}]`);
      }
    } catch (error) {
      // Includes network errors and the AbortError on timeout — all non-fatal.
      this.logger.warn(
        `Revalidation webhook failed for [${tags.join(', ')}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
