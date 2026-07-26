import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MediaPurpose, MediaStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Profile-media operations for the authenticated user. Kept separate from
 * AuthService (which owns credentials/session concerns) — this module
 * touches `User.avatarUrl` (legacy direct-upload path) and
 * `User.avatarMediaId` (media-pipeline path). Profile projection is
 * delegated back to AuthService.getProfile so URL resolution for both
 * pointers lives in exactly one place (AuthService.toProfile).
 *
 * The two avatar pointers are kept mutually exclusive by every method here:
 * setting one always clears and best-effort cleans up the other, so a stale
 * pointer from an earlier upload path never silently overrides a newer one
 * (see AuthService.toProfile's doc comment on why it still tolerates either
 * state independently rather than assuming this invariant holds).
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Legacy direct-upload path: stores the uploaded image as the user's avatar
   * and points User.avatarUrl at the new S3 object key. Kept for backward
   * compatibility with clients not yet on the media pipeline (see
   * setAvatarFromMedia for the current path) — new mobile builds use the
   * direct-to-S3 flow instead. If an avatar already existed on *either*
   * pointer, its object/asset is cleaned up only after the new upload and the
   * DB pointer both succeed, and always best-effort — a cleanup failure is
   * logged, not surfaced, since the new avatar is already live.
   */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<UserProfileDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, avatarMediaId: true },
    });
    if (!existing) {
      // Defensive: JwtStrategy already rejects tokens for deleted/missing users.
      throw new NotFoundException('User not found');
    }

    // buildAvatarKey rejects unsupported MIME types with a 400.
    const newKey = this.storage.buildAvatarKey(userId, file.mimetype);
    await this.storage.uploadObject(newKey, file.buffer, file.mimetype);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: newKey, avatarMediaId: null },
    });

    const previousKey = existing.avatarUrl;
    if (previousKey && previousKey !== newKey) {
      try {
        await this.storage.deleteObject(previousKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete replaced avatar object ${previousKey} for user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      }
    }
    if (existing.avatarMediaId) {
      await this.media.deleteMedia(userId, existing.avatarMediaId).catch((error) => {
        this.logger.warn(
          `Failed to delete replaced avatar media asset ${existing.avatarMediaId} for user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      });
    }

    this.logger.log(`Avatar updated for user ${userId}`);
    return this.authService.getProfile(userId);
  }

  /**
   * Current path: points the user's avatar at an already-uploaded, already-
   * processed MediaAsset (see MediaController — the client authorizes an
   * upload, PUTs the file directly to S3, confirms it, waits for `status`
   * READY, then calls this). Requires the asset be owned by the caller, have
   * purpose AVATAR, and already be READY — an asset still PROCESSING has no
   * variants yet to display, so setting it as the live avatar early would
   * leave `avatarVariants` empty for an indeterminate window.
   *
   * Whatever was previously the avatar (on either pointer) is cleaned up
   * best-effort *after* the new pointer is committed, same ordering
   * rationale as uploadAvatar/deleteAvatar.
   */
  async setAvatarFromMedia(userId: string, mediaId: string): Promise<UserProfileDto> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset || asset.ownerId !== userId) {
      throw new NotFoundException('MEDIA_NOT_FOUND');
    }
    if (asset.purpose !== MediaPurpose.AVATAR) {
      throw new BadRequestException('MEDIA_WRONG_PURPOSE: expected an AVATAR-purpose media asset');
    }
    if (asset.status !== MediaStatus.READY) {
      throw new BadRequestException(`MEDIA_NOT_READY: asset status is ${asset.status}`);
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, avatarMediaId: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarMediaId: mediaId, avatarUrl: null },
    });

    if (existing.avatarMediaId && existing.avatarMediaId !== mediaId) {
      await this.media.deleteMedia(userId, existing.avatarMediaId).catch((error) => {
        this.logger.warn(
          `Failed to delete replaced avatar media asset ${existing.avatarMediaId} for user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      });
    }
    if (existing.avatarUrl) {
      await this.storage.deleteObject(existing.avatarUrl).catch((error) => {
        this.logger.warn(
          `Failed to delete replaced legacy avatar object ${existing.avatarUrl} for user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      });
    }

    this.logger.log(`Avatar set from media asset ${mediaId} for user ${userId}`);
    return this.authService.getProfile(userId);
  }

  /**
   * Removes the user's avatar on whichever pointer is set (nulls it), then
   * best-effort cleans up the underlying object/asset. Idempotent — when no
   * avatar is set this is a no-op that still returns the (avatar-less)
   * profile with 200, never a 404, matching the project's save/unsave
   * idempotency convention.
   *
   * Each DB pointer is nulled *before* its corresponding cleanup, not after:
   * if cleanup happened first and the DB write then failed (e.g. a transient
   * connection error), the pointer would keep referencing a now-deleted
   * object/asset, and the next profile read would hand the client a broken
   * reference — a real inconsistency window, not hypothetical. Nulling first
   * means the worst case on a cleanup failure is an orphaned object (logged,
   * not user-visible), never a broken pointer.
   */
  async deleteAvatar(userId: string): Promise<UserProfileDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, avatarMediaId: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    if (existing.avatarMediaId) {
      const previousMediaId = existing.avatarMediaId;
      await this.prisma.user.update({ where: { id: userId }, data: { avatarMediaId: null } });
      await this.media.deleteMedia(userId, previousMediaId).catch((error) => {
        this.logger.warn(
          `Failed to delete avatar media asset ${previousMediaId} for user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      });
      this.logger.log(`Avatar removed for user ${userId}`);
    }

    if (existing.avatarUrl) {
      const previousKey = existing.avatarUrl;
      await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
      try {
        await this.storage.deleteObject(previousKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete avatar object ${previousKey} for user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      }
      this.logger.log(`Avatar removed for user ${userId}`);
    }

    return this.authService.getProfile(userId);
  }
}
