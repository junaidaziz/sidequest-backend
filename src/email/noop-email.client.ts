import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailProviderClient, EmailSendResult } from './email-provider.interface';

/**
 * Dev/stub email provider (Phase 4). Logs a one-line summary of each message and
 * returns success without contacting any provider. Never throws and never leaks
 * the body (which can contain reset/invite tokens) — only the subject + recipient
 * are logged. Swapped for a real provider (env var + implementation) later; the
 * password-reset / invite flows are wired end-to-end now regardless, they just
 * don't deliver anywhere until then.
 */
@Injectable()
export class NoOpEmailClient implements EmailProviderClient {
  private readonly logger = new Logger(NoOpEmailClient.name);

  send(message: EmailMessage): Promise<EmailSendResult> {
    this.logger.log(`[noop-email] would send "${message.subject}" to ${message.to}`);
    return Promise.resolve({ status: 'ok', id: 'noop' });
  }
}
