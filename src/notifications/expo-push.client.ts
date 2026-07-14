import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from 'expo-server-sdk';
import {
  PushMessage,
  PushProviderClient,
  PushReceipt,
  PushTicket,
} from './push-provider.interface';

/**
 * Thin adapter over `expo-server-sdk` (Decision 6 — Expo Push Notifications).
 * The only file in the codebase that imports the Expo SDK, so every other
 * notification unit is exercised against the PushProviderClient interface with
 * an in-memory fake — no network, no EAS credentials needed in tests.
 *
 * `EXPO_ACCESS_TOKEN` is optional: unset it and the SDK sends unauthenticated
 * (fine for dev/Expo Go); set it in production for enhanced-security delivery.
 * Instantiated once (like StorageService's S3Client) rather than per request.
 */
@Injectable()
export class ExpoPushClient implements PushProviderClient {
  private readonly logger = new Logger(ExpoPushClient.name);
  private readonly expo: Expo;

  constructor(config: ConfigService) {
    // Empty/undefined token => unauthenticated send, which Expo permits.
    const accessToken = config.get<string>('EXPO_ACCESS_TOKEN') || undefined;
    this.expo = new Expo({ accessToken });
  }

  isValidToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  chunk(messages: PushMessage[]): PushMessage[][] {
    // Chunk at the provider's documented per-request limit. Done on our own
    // PushMessage[] rather than round-tripping through the SDK's typed array,
    // whose `to` field widens to string|string[] and would not map back cleanly.
    const size = Expo.pushNotificationChunkSizeLimit;
    const chunks: PushMessage[][] = [];
    for (let i = 0; i < messages.length; i += size) {
      chunks.push(messages.slice(i, i + size));
    }
    return chunks;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets = await this.expo.sendPushNotificationsAsync(
      messages.map((m) => this.toExpoMessage(m)),
    );
    return tickets.map((ticket) => this.fromExpoTicket(ticket));
  }

  async getReceipts(receiptIds: string[]): Promise<Record<string, PushReceipt>> {
    const receipts = await this.expo.getPushNotificationReceiptsAsync(receiptIds);
    const out: Record<string, PushReceipt> = {};
    for (const [id, receipt] of Object.entries(receipts)) {
      out[id] = this.fromExpoReceipt(receipt);
    }
    return out;
  }

  private toExpoMessage(message: PushMessage): ExpoPushMessage {
    return {
      to: message.to,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: 'default',
    };
  }

  private fromExpoTicket(ticket: ExpoPushTicket): PushTicket {
    if (ticket.status === 'ok') {
      return { status: 'ok', id: ticket.id };
    }
    return {
      status: 'error',
      message: ticket.message,
      details: { error: ticket.details?.error },
    };
  }

  private fromExpoReceipt(receipt: ExpoPushReceipt): PushReceipt {
    if (receipt.status === 'ok') {
      return { status: 'ok' };
    }
    return {
      status: 'error',
      message: receipt.message,
      details: { error: receipt.details?.error },
    };
  }
}
