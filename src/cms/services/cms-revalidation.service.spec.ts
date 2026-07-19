import { ConfigService } from '@nestjs/config';
import { CmsRevalidationService } from './cms-revalidation.service';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (k: string): string | undefined => values[k] } as unknown as ConfigService;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('CmsRevalidationService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('no-ops when WEB_APP_URL / secret are unset', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new CmsRevalidationService(configWith({}));
    service.trigger(['cms:faqs']);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops on an empty tag list', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new CmsRevalidationService(
      configWith({ WEB_APP_URL: 'https://web', CMS_REVALIDATE_SECRET: 's' }),
    );
    service.trigger([]);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the revalidation endpoint with the secret header and tags', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new CmsRevalidationService(
      configWith({ WEB_APP_URL: 'https://web/', CMS_REVALIDATE_SECRET: 'shh' }),
    );
    service.trigger(['cms:faqs', 'cms:sections']);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://web/api/revalidate'); // trailing slash trimmed
    expect(init.method).toBe('POST');
    expect(init.headers['x-revalidate-secret']).toBe('shh');
    expect(JSON.parse(init.body)).toEqual({ tags: ['cms:faqs', 'cms:sections'] });
  });

  it('swallows a non-ok response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new CmsRevalidationService(
      configWith({ WEB_APP_URL: 'https://web', CMS_REVALIDATE_SECRET: 's' }),
    );
    expect(() => service.trigger(['cms:faqs'])).not.toThrow();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('swallows a network error / timeout', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('aborted'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new CmsRevalidationService(
      configWith({ WEB_APP_URL: 'https://web', CMS_REVALIDATE_SECRET: 's' }),
    );
    expect(() => service.trigger(['cms:faqs'])).not.toThrow();
    await flush();
  });

  it('builds a slug-specific tag', () => {
    expect(CmsRevalidationService.slugTag('pages', 'about')).toBe('cms:pages:about');
  });
});
