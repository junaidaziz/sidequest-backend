import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { UserProfileDto } from '../auth/dto/user-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Profile-media operations for the authenticated user. Kept separate from
 * AuthService (which owns credentials/session concerns) — this module only
 * touches the avatar object and the User.avatarUrl key. Profile projection is
 * delegated back to AuthService.getProfile so the presigned-URL resolution
 * lives in exactly one place.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Stores the uploaded image as the user's avatar and points User.avatarUrl at
   * the new S3 object key. If an avatar already existed, its object is deleted
   * only after the new upload and the DB pointer both succeed — so a failure at
   * any earlier step never orphans the old object nor leaves the row pointing at
   * a missing key. The old-object delete is best-effort: a cleanup failure is
   * logged, not surfaced, since the new avatar is already live.
   */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<UserProfileDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    if (!existing) {
      // Defensive: JwtStrategy already rejects tokens for deleted/missing users.
      throw new NotFoundException('User not found');
    }

    // buildAvatarKey rejects unsupported MIME types with a 400.
    const newKey = this.storage.buildAvatarKey(userId, file.mimetype);
    await this.storage.uploadObject(newKey, file.buffer, file.mimetype);
    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl: newKey } });

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

    this.logger.log(`Avatar updated for user ${userId}`);
    return this.authService.getProfile(userId);
  }

  /**
   * Removes the user's avatar: nulls User.avatarUrl, then best-effort deletes
   * the S3 object. Idempotent — when no avatar is set this is a no-op that
   * still returns the (avatar-less) profile with 200, never a 404, matching
   * the project's save/unsave idempotency convention.
   *
   * DB pointer is nulled *before* the S3 delete, not after: if the delete
   * happened first and the DB write then failed (e.g. a transient connection
   * error), avatarUrl would keep pointing at a now-deleted object, and the
   * next profile read would hand the client a presigned URL for a 404 — a
   * real inconsistency window, not hypothetical. Nulling first means the
   * worst case on an S3 failure is an orphaned object (logged, not
   * user-visible), never a broken pointer.
   */
  async deleteAvatar(userId: string): Promise<UserProfileDto> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
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
