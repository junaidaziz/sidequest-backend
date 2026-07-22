import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER_CLIENT } from './email-provider.interface';
import { EmailService } from './email.service';
import { NoOpEmailClient } from './noop-email.client';
import { ResendEmailClient } from './resend-email.client';

export function createEmailProvider(config: ConfigService) {
  const environment = config.get<string>('NODE_ENV');
  if (environment === 'development' || environment === 'test') return new NoOpEmailClient();
  const provider = config.get<string>('EMAIL_PROVIDER');
  if (provider !== 'resend') throw new Error('Production requires EMAIL_PROVIDER=resend');
  return new ResendEmailClient(config);
}

/**
 * Provider-agnostic email module (Phase 4). Binds the EMAIL_PROVIDER_CLIENT
 * token to the no-op dev implementation — the single wired provider for now.
 * To ship real delivery, add a real client (e.g. ResendEmailClient) and switch
 * the `useClass` below based on an env var; no consumer changes needed.
 */
@Module({
  providers: [
    EmailService,
    {
      provide: EMAIL_PROVIDER_CLIENT,
      inject: [ConfigService],
      useFactory: createEmailProvider,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
