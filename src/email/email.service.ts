import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EMAIL_PROVIDER_CLIENT,
  EmailMessage,
  EmailProviderClient,
  EmailSendResult,
} from './email-provider.interface';

/**
 * Higher-level email API other admin modules call via DI. Owns message
 * composition (subject/html/text) so callers pass domain data, not markup.
 *
 * Every send is best-effort: a provider failure is logged and swallowed, never
 * propagated — mirroring the codebase-wide "a side-effect failure must never
 * fail the primary write" convention (a failed invite email must not roll back
 * the admin row that was already created).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(@Inject(EMAIL_PROVIDER_CLIENT) private readonly client: EmailProviderClient) {}

  /** Sends a pre-composed message, swallowing (but logging) any failure. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const result = await this.client.send(message);
      if (result.status === 'error') {
        this.logger.warn(`Email to ${message.to} failed: ${result.message ?? 'unknown error'}`);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Email provider threw sending to ${message.to}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { status: 'error', message: 'provider threw' };
    }
  }

  /** Password-reset email for the admin portal. `resetUrl` embeds the raw token. */
  sendAdminPasswordReset(to: string, resetUrl: string): Promise<EmailSendResult> {
    const safeUrl = this.escapeHtml(resetUrl);
    return this.send({
      to,
      subject: 'Reset your SideQuest admin password',
      html:
        `<p>A password reset was requested for your SideQuest admin account.</p>` +
        `<p><a href="${safeUrl}">Reset your password</a> (link expires in 1 hour).</p>` +
        `<p>If you did not request this, you can safely ignore this email.</p>`,
      text:
        `A password reset was requested for your SideQuest admin account.\n` +
        `Reset your password (expires in 1 hour): ${resetUrl}\n` +
        `If you did not request this, ignore this email.`,
    });
  }

  /** Invitation email for a newly-created (pending) admin. `acceptUrl` embeds the token. */
  sendAdminInvite(to: string, inviterName: string, acceptUrl: string): Promise<EmailSendResult> {
    const safeInviter = this.escapeHtml(inviterName);
    const safeUrl = this.escapeHtml(acceptUrl);
    return this.send({
      to,
      subject: 'You have been invited to the SideQuest admin portal',
      html:
        `<p>${safeInviter} invited you to the SideQuest admin portal.</p>` +
        `<p><a href="${safeUrl}">Accept the invitation</a> and set your password.</p>`,
      text:
        `${inviterName} invited you to the SideQuest admin portal.\n` +
        `Accept and set your password: ${acceptUrl}`,
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>'"]/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;',
        })[char] as string,
    );
  }
}
