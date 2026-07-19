import { Module } from '@nestjs/common';
import { EMAIL_PROVIDER_CLIENT } from './email-provider.interface';
import { EmailService } from './email.service';
import { NoOpEmailClient } from './noop-email.client';

/**
 * Provider-agnostic email module (Phase 4). Binds the EMAIL_PROVIDER_CLIENT
 * token to the no-op dev implementation — the single wired provider for now.
 * To ship real delivery, add a real client (e.g. ResendEmailClient) and switch
 * the `useClass` below based on an env var; no consumer changes needed.
 */
@Module({
  providers: [EmailService, { provide: EMAIL_PROVIDER_CLIENT, useClass: NoOpEmailClient }],
  exports: [EmailService],
})
export class EmailModule {}
