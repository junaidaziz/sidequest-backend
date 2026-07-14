/**
 * Provider-agnostic push abstraction (M21.4). The concrete implementation
 * (ExpoPushClient) wraps `expo-server-sdk`; the queue producer and the delivery
 * processor depend only on this interface via the PUSH_PROVIDER_CLIENT token, so
 * unit tests inject an in-memory fake and never hit the network — the same
 * seam StorageService (S3Client) and AuthService (OAuth2Client) use to keep an
 * external SDK call testable.
 */

/** DI token the module binds ExpoPushClient to and the processor injects. */
export const PUSH_PROVIDER_CLIENT = 'PUSH_PROVIDER_CLIENT';

/** A single outbound push message, provider-neutral. */
export interface PushMessage {
  /** The device push token to deliver to. */
  to: string;
  title: string;
  body: string;
  /** Deep-link / routing payload, surfaced to the app on tap. */
  data?: Record<string, unknown>;
}

/**
 * Result of a send attempt for one message. `ok` carries a receipt id to poll
 * later; `error` carries the provider's reason — `DeviceNotRegistered` is the
 * one we act on by disabling the offending token.
 */
export interface PushTicket {
  status: 'ok' | 'error';
  /** Present on an `ok` ticket — the id used to fetch the delivery receipt. */
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Delivery receipt fetched a while after send, keyed by the ticket's receipt id. */
export interface PushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** The provider reason that means "this token is dead — stop using it". */
export const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

/** Minimal push provider surface the notifications feature depends on. */
export interface PushProviderClient {
  /** True when `token` is a well-formed token this provider can deliver to. */
  isValidToken(token: string): boolean;
  /** Splits messages into provider-sized batches. */
  chunk(messages: PushMessage[]): PushMessage[][];
  /** Sends one batch; tickets are returned positionally (nth ticket ⇄ nth message). */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Fetches delivery receipts for previously-issued receipt ids. */
  getReceipts(receiptIds: string[]): Promise<Record<string, PushReceipt>>;
}
