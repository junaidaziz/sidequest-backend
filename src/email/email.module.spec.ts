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
  it('uses no-op only in explicit development/test environments', () => {
    expect(createEmailProvider(config({ NODE_ENV: 'test' }))).toBeInstanceOf(NoOpEmailClient);
    expect(createEmailProvider(config({ NODE_ENV: 'development' }))).toBeInstanceOf(
      NoOpEmailClient,
    );
  });

  it('fails closed outside dev/test without a production provider', () => {
    expect(() => createEmailProvider(config({ NODE_ENV: 'production' }))).toThrow(
      'Production requires EMAIL_PROVIDER=resend',
    );
  });

  it('constructs the real provider only with required production credentials', () => {
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
});
