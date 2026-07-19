/**
 * Provider-agnostic email abstraction (Phase 4). Mirrors the PushProviderClient
 * DI-token-interface pattern exactly: every consumer (admin invites, password
 * resets) depends only on this interface via the EMAIL_PROVIDER_CLIENT token, so
 * a real provider (Resend/SES/SendGrid) can be plugged in later purely by
 * swapping the bound implementation + an env var — no consumer changes.
 *
 * The only wired implementation this phase is NoOpEmailClient (logs to console,
 * never sends, never throws), matching the "email has zero existing infra" reality.
 */

/** DI token the module binds NoOpEmailClient to and EmailService injects. */
export const EMAIL_PROVIDER_CLIENT = 'EMAIL_PROVIDER_CLIENT';

/** A single outbound email, provider-neutral. */
export interface EmailMessage {
  /** Recipient address. */
  to: string;
  subject: string;
  /** HTML body — the primary rendering. */
  html: string;
  /** Optional plain-text fallback for clients that don't render HTML. */
  text?: string;
}

/** Result of a send attempt. `id` is the provider's message id when available. */
export interface EmailSendResult {
  status: 'ok' | 'error';
  /** Present on an `ok` result — the provider's message id (or a stub id). */
  id?: string;
  /** Present on an `error` result — the provider's reason. */
  message?: string;
}

/** Minimal email provider surface every email consumer depends on. */
export interface EmailProviderClient {
  /** Sends one message. Implementations must never throw — return an error result instead. */
  send(message: EmailMessage): Promise<EmailSendResult>;
}
