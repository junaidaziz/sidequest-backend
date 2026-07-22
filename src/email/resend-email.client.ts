import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMessage, EmailProviderClient, EmailSendResult } from './email-provider.interface';

@Injectable()
export class ResendEmailClient implements EmailProviderClient {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('RESEND_API_KEY');
    this.from = config.getOrThrow<string>('EMAIL_FROM');
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, ...message }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
        name?: string;
      } | null;
      if (!response.ok) {
        return {
          status: 'error',
          message: body?.message ?? body?.name ?? `HTTP ${response.status}`,
        };
      }
      return { status: 'ok', id: body?.id };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : 'network error' };
    }
  }
}
