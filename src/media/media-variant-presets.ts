import { MediaPurpose } from '@prisma/client';

export interface VariantDimensions {
  width: number;
  height?: number;
}

/**
 * Avatar variant pixel dimensions — grounded in the mobile app's actual
 * rendered avatar sizes (checked directly in the mobile codebase, not the
 * generic numbers from the pipeline spec), scaled up for common device pixel
 * ratios so a variant is never smaller than what the highest-density device
 * actually needs at that logical size:
 *   - LeaderboardsScreen "You" row: 40pt  -> up to 120px @3x
 *   - TodayScreen header avatar:    48pt  -> up to 144px @3x
 *   - YouScreen profile header:     76pt  -> up to 228px @3x
 *   - EditProfileScreen editing:    96pt  -> up to 288px @3x
 * Square (width === height) since every avatar surface in the app renders a
 * circular/square avatar — never stretched into a non-1:1 aspect ratio.
 */
export const AVATAR_VARIANTS: Readonly<Record<string, VariantDimensions>> = {
  xs: { width: 120, height: 120 }, // compact list rows (Leaderboards, feeds)
  sm: { width: 150, height: 150 }, // tab/nav headers (Today)
  md: { width: 240, height: 240 }, // profile header (You)
  lg: { width: 320, height: 320 }, // full editing preview (Edit Profile)
};

/**
 * Card/cover-image variant pixel dimensions. Not currently backed by a real
 * UI surface in this app (no challenge-cover or campaign-banner entity
 * exists yet — see the schema.prisma comment above MediaPurpose), so these
 * are NOT wired to any MediaPurpose today. Defined here, unused, only so
 * MediaProcessingService has a ready preset the moment such a feature is
 * built, per the pipeline spec's card-variant recommendation — do not treat
 * this as evidence the feature exists.
 */
export const CARD_VARIANTS: Readonly<Record<string, VariantDimensions>> = {
  thumbnail: { width: 240, height: 160 },
  small: { width: 480, height: 320 },
  medium: { width: 960, height: 640 },
  large: { width: 1440, height: 960 },
};

/**
 * Proof/task-attachment variant pixel dimensions. Deliberately NOT square —
 * evidence photos must preserve their original aspect ratio (a forced square
 * crop can remove the exact detail the photo exists to show), so only
 * `width` is specified; height is derived per-image preserving aspect ratio
 * (see MediaProcessingService.resizeWithinWidth). Shared between PROOF and
 * TASK_ATTACHMENT since both are the same kind of content (a photo submitted
 * as evidence of a completed real-world action) reviewed the same way
 * (thumbnail in a list, full detail in review).
 */
export const EVIDENCE_PHOTO_VARIANTS: Readonly<Record<string, VariantDimensions>> = {
  thumbnail: { width: 240 },
  small: { width: 480 },
  medium: { width: 960 },
  large: { width: 1600 },
};

/**
 * Resolves the variant preset table for a given purpose. AVATAR gets the
 * square avatar presets; PROOF and TASK_ATTACHMENT both get the
 * aspect-ratio-preserving evidence-photo presets (same underlying content
 * type — see EVIDENCE_PHOTO_VARIANTS above).
 */
export function variantPresetsFor(
  purpose: MediaPurpose,
): Readonly<Record<string, VariantDimensions>> {
  switch (purpose) {
    case MediaPurpose.AVATAR:
      return AVATAR_VARIANTS;
    case MediaPurpose.PROOF:
    case MediaPurpose.TASK_ATTACHMENT:
      return EVIDENCE_PHOTO_VARIANTS;
    default: {
      const exhaustive: never = purpose;
      throw new Error(`No variant preset defined for MediaPurpose ${String(exhaustive)}`);
    }
  }
}

/** Whether a purpose's variants should be square-cropped (cover) vs. preserve the original aspect ratio. */
export function isSquarePurpose(purpose: MediaPurpose): boolean {
  return purpose === MediaPurpose.AVATAR;
}
