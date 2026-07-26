/**
 * Derives a variant's object key from its original's key by nesting the
 * variant under the original's own unique path segment — e.g.
 * `avatars/{userId}/{uuid}.jpg` -> `avatars/{userId}/{uuid}/md.webp`. Every
 * original key already ends in a globally-unique uuid filename (see
 * StorageService's key builders), so this can never collide across two
 * different MediaAssets, and needs no extra randomness of its own.
 */
export function buildVariantKey(originalKey: string, variantName: string, format: string): string {
  const withoutExtension = originalKey.replace(/\.[^./]+$/, '');
  return `${withoutExtension}/${variantName}.${format}`;
}
