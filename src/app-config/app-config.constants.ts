/**
 * The allow-list of AppConfig keys exposed on the unauthenticated
 * `GET /config/public` endpoint.
 *
 * DESIGN DECISION (flagged for review): rather than an admin-flippable
 * `isPublic` boolean column on AppConfig, which key is public is a
 * **code-reviewed constant**. This is a deliberately stronger posture — an admin
 * with `app_config.manage` cannot accidentally (or maliciously) expose an
 * internal feature flag or secret-ish value to the whole internet by toggling a
 * checkbox; changing the public surface requires a code change that goes through
 * review. It also avoids a schema migration (none is otherwise needed for this
 * phase). Everything NOT listed here is internal-only and is never returned by
 * the public endpoint, regardless of its value.
 *
 * Only genuinely public, client-consumed values belong here: store URLs, minimum
 * supported app versions, and public contact/legal links. Never a feature flag.
 */
export const PUBLIC_APP_CONFIG_KEYS: readonly string[] = [
  'appStoreUrl',
  'playStoreUrl',
  'minIosVersion',
  'minAndroidVersion',
  'contactEmail',
  'supportUrl',
  'privacyUrl',
  'termsUrl',
  'socialLinks',
] as const;

/** Whether a config key is part of the public surface. */
export function isPublicConfigKey(key: string): boolean {
  return PUBLIC_APP_CONFIG_KEYS.includes(key);
}

/** Valid AppConfig key shape: dot/camel segments, e.g. `appStoreUrl`, `feature.newHome`. */
export const APP_CONFIG_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/;
