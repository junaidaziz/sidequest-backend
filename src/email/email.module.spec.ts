import { ConfigService } from '@nestjs/config';
import { createEmailProvider } from './email.module';
import { NoOpEmailClient } from './noop-email.client';
import { ResendEmailClient } from './resend-email.client';

const config = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    },
  }) as ConfigService;

describe('email provider selection', () => {
  it('is ALWAYS no-op in test, regardless of EMAIL_PROVIDER — automated runs must never hit the real API', () => {
    expect(createEmailProvider(config({ NODE_ENV: 'test' }))).toBeInstanceOf(NoOpEmailClient);
    expect(
      createEmailProvider(
        config({
          NODE_ENV: 'test',
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 're_test',
          EMAIL_FROM: 'SideQuest <admin@example.com>',
        }),
      ),
    ).toBeInstanceOf(NoOpEmailClient);
  });

  it('defaults to no-op in development without an explicit EMAIL_PROVIDER opt-in', () => {
    expect(createEmailProvider(config({ NODE_ENV: 'development' }))).toBeInstanceOf(
      NoOpEmailClient,
    );
  });

  it('uses the real provider in development when EMAIL_PROVIDER=resend is explicitly set', () => {
    expect(
      createEmailProvider(
        config({
          NODE_ENV: 'development',
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 're_test',
          EMAIL_FROM: 'SideQuest <admin@example.com>',
        }),
      ),
    ).toBeInstanceOf(ResendEmailClient);
  });

  it('fails closed in production without EMAIL_PROVIDER=resend', () => {
    expect(() => createEmailProvider(config({ NODE_ENV: 'production' }))).toThrow(
      /EMAIL_PROVIDER=resend is required/,
    );
  });

  it('fails closed for any non-development, non-test NODE_ENV, not just the literal string "production"', () => {
    expect(() => createEmailProvider(config({ NODE_ENV: 'staging' }))).toThrow(
      /EMAIL_PROVIDER=resend is required/,
    );
    expect(() => createEmailProvider(config({ NODE_ENV: 'preview' }))).toThrow(
      /EMAIL_PROVIDER=resend is required/,
    );
  });

  it('fails closed when NODE_ENV is unset entirely — unset must never silently behave like development', () => {
    expect(() => createEmailProvider(config({}))).toThrow(/EMAIL_PROVIDER=resend is required/);
  });

  it('constructs the real provider in production with EMAIL_PROVIDER=resend and required credentials', () => {
    expect(
      createEmailProvider(
        config({
          NODE_ENV: 'production',
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 're_test',
          EMAIL_FROM: 'SideQuest <admin@example.com>',
        }),
      ),
    ).toBeInstanceOf(ResendEmailClient);
  });

  it('fails at boot with a clear error when EMAIL_PROVIDER=resend is set but RESEND_API_KEY is missing', () => {
    expect(() =>
      createEmailProvider(config({ NODE_ENV: 'development', EMAIL_PROVIDER: 'resend' })),
    ).toThrow('Missing RESEND_API_KEY');
  });

  it('fails at boot with a clear error when EMAIL_PROVIDER=resend is set but EMAIL_FROM is missing', () => {
    expect(() =>
      createEmailProvider(
        config({ NODE_ENV: 'development', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }),
      ),
    ).toThrow('Missing EMAIL_FROM');
  });
});
