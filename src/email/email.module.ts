import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER_CLIENT, EmailProviderClient } from './email-provider.interface';
import { EmailService } from './email.service';
import { NoOpEmailClient } from './noop-email.client';
import { ResendEmailClient } from './resend-email.client';

const logger = new Logger('EmailModule');

/** The only environment name that gets a silent no-op default without an explicit opt-in. */
const SAFE_DEFAULT_NOOP_ENV = 'development';

/**
 * Selects the email provider by what's actually configured, not by env name —
 * so a developer who sets `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` locally
 * gets real sends in dev (useful for testing the real integration), not a
 * silent no-op. Two exceptions carve out safe defaults; everything else fails
 * closed rather than silently no-opping:
 *
 * - `NODE_ENV=test` is ALWAYS no-op, unconditionally — automated test runs
 *   must never hit the real Resend API (flaky, slow, costs money, could spam
 *   real inboxes from a CI run). This is not configurable.
 * - `NODE_ENV=development` (exactly, and only) defaults to no-op without an
 *   explicit `EMAIL_PROVIDER=resend` opt-in — a safe fallback for local work,
 *   not a footgun.
 *
 * Every OTHER `NODE_ENV` value — `production`, `staging`, any other custom
 * deployment-environment name, or `NODE_ENV` simply being unset/misspelled —
 * fails loud at boot unless `EMAIL_PROVIDER=resend` is explicitly set. An
 * earlier version of this function only fail-closed for the exact string
 * `'production'`, which meant a staging deployment (or any environment whose
 * `NODE_ENV` isn't precisely `production`) that forgot to configure email
 * would boot fine and silently send nothing — deliberately tightened so the
 * safe-default list is an explicit allow-list (`test`, `development`), not a
 * deny-list of one string.
 *
 * `ResendEmailClient`'s constructor validates `RESEND_API_KEY`/`EMAIL_FROM`
 * via `ConfigService.getOrThrow`, so opting into Resend with a missing
 * credential fails at boot with a clear error, never a silent runtime no-op.
 */
export function createEmailProvider(config: ConfigService): EmailProviderClient {
  const environment = config.get<string>('NODE_ENV');
  if (environment === 'test') {
    return new NoOpEmailClient();
  }

  const provider = config.get<string>('EMAIL_PROVIDER');
  if (provider === 'resend') {
    logger.log('Email provider: Resend (real sends enabled)');
    return new ResendEmailClient(config);
  }

  if (environment !== SAFE_DEFAULT_NOOP_ENV) {
    throw new Error(
      `EMAIL_PROVIDER=resend is required outside development/test (NODE_ENV="${environment ?? 'unset'}")`,
    );
  }

  logger.log(
    'Email provider: no-op (logged only) — set EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM to send real emails in this environment',
  );
  return new NoOpEmailClient();
}

/**
 * Provider-agnostic email module. Binds the `EMAIL_PROVIDER_CLIENT` token to
 * whichever client `createEmailProvider` selects — consumers (`EmailService`
 * and everything built on it) only ever depend on the `EmailProviderClient`
 * interface, never a concrete provider. Adding a second real provider later
 * is a new class implementing that interface plus a branch in
 * `createEmailProvider`, not a change to any calling code.
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
