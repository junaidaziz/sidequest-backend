import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ReferralsService } from '../referrals/referrals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePasswordResponseDto } from './dto/change-password-response.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { DeleteAccountResponseDto } from './dto/delete-account-response.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SignupDto } from './dto/signup.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { JwtPayload, TokenType } from './types/jwt-payload.interface';

const BCRYPT_ROUNDS = 12;
/** Deliberately identical for unknown-email and wrong-password to avoid enumeration. */
const GENERIC_AUTH_ERROR = 'Invalid email or password';
/**
 * Single non-leaking error for every Google sign-in rejection (bad signature,
 * unverified email, missing claims, or a concurrent-sign-in write race) — same
 * enumeration-resistant philosophy as GENERIC_AUTH_ERROR, so the caller can
 * never tell which specific check failed.
 */
const GENERIC_GOOGLE_AUTH_ERROR = 'Google authentication failed';
const INVALID_REFRESH_ERROR = 'Invalid refresh token';
/**
 * Anonymized display identity for a soft-deleted account (Decision 7). The row
 * itself is retained (email/googleId stay taken, never released for re-signup);
 * only the human-facing identity is scrubbed so any surface that reads this
 * user's displayName renders a placeholder rather than real PII.
 */
const DELETED_DISPLAY_NAME = 'Deleted User';
/** Distinct, non-confusing error for password ops on a no-password account. */
const NO_PASSWORD_ACCOUNT_ERROR =
  'This account has no password set (it uses Google sign-in or is a guest session), so its password cannot be changed.';
/**
 * A real bcrypt hash (cost 12) with no corresponding password. Compared
 * against on the "email not found" fast path so login() takes the same
 * wall-clock time whether or not the email exists — otherwise the missing
 * bcrypt.compare() call is a timing side-channel that leaks account existence.
 */
const DUMMY_BCRYPT_HASH = '$2b$12$NRa8c1JQWgpx8Ftwwgz8VOc967Tx.VK9IeZ02zmPkAFFnoiY0bnMK';

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  refreshTokenHash: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly guestRefreshTtl: string;
  private readonly googleWebClientId: string;
  private readonly googleIosClientId: string;
  /**
   * Stateless verifier for Google-issued ID tokens. Instantiated without a
   * client id/secret because we only ever *verify* tokens (audience is passed
   * per-call to verifyIdToken), never perform a server-side OAuth code exchange.
   */
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly storage: StorageService,
    private readonly referrals: ReferralsService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.getOrThrow<string>('JWT_SECRET');
    this.accessTtl = config.getOrThrow<string>('JWT_ACCESS_TOKEN_TTL');
    this.refreshTtl = config.getOrThrow<string>('JWT_REFRESH_TOKEN_TTL');
    this.guestRefreshTtl = config.getOrThrow<string>('GUEST_TOKEN_TTL');
    this.googleWebClientId = config.getOrThrow<string>('GOOGLE_OAUTH_WEB_CLIENT_ID');
    this.googleIosClientId = config.getOrThrow<string>('GOOGLE_OAUTH_IOS_CLIENT_ID');
  }

  /** Bootstraps an anonymous session: a credential-less guest User + token pair. */
  async createGuest(): Promise<AuthResponseDto> {
    const id = randomUUID();
    const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(id, true);
    // create() returns the written row — no separate read needed for the profile.
    const user = await this.prisma.user.create({ data: { id, isGuest: true, refreshTokenHash } });
    this.logger.log(`Guest session created: ${id}`);
    return { accessToken, refreshToken, user: await this.toProfile(user) };
  }

  /**
   * Registers a full account. When a valid guest access token is supplied, the
   * guest's existing row is upgraded in place so mission/XP history is preserved;
   * otherwise a fresh account row is created.
   */
  async signup(dto: SignupDto, bearerToken?: string): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const guestUserId = this.resolveGuestUserId(bearerToken);
    // Validate any referral code BEFORE the account write (M20.3) so an invalid
    // code is a clean 400 with no half-created account. Self-referral is
    // rejected here when the referee (the guest being upgraded) is known.
    const referrerId = dto.referralCode
      ? await this.referrals.resolveReferrer(dto.referralCode, guestUserId ?? undefined)
      : null;
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      if (guestUserId) {
        const guest = await this.prisma.user.findUnique({
          where: { id: guestUserId },
        });
        if (guest && guest.isGuest && !guest.deletedAt) {
          const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(
            guest.id,
            false,
          );
          const upgraded = await this.prisma.user.update({
            where: { id: guest.id },
            data: {
              email: dto.email,
              passwordHash,
              displayName: dto.displayName ?? guest.displayName,
              isGuest: false,
              refreshTokenHash,
            },
          });
          this.logger.log(`Guest ${guest.id} upgraded to full account`);
          await this.attributeReferral(referrerId, dto.referralCode, upgraded.id);
          return { accessToken, refreshToken, user: await this.toProfile(upgraded) };
        }
      }

      const id = randomUUID();
      const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(id, false);
      const created = await this.prisma.user.create({
        data: {
          id,
          email: dto.email,
          passwordHash,
          displayName: dto.displayName ?? null,
          isGuest: false,
          refreshTokenHash,
        },
      });
      this.logger.log(`New account created: ${id}`);
      await this.attributeReferral(referrerId, dto.referralCode, created.id);
      return { accessToken, refreshToken, user: await this.toProfile(created) };
    } catch (error) {
      // Backstop for the race between the uniqueness pre-check and the write:
      // a concurrent signup on the same email must still surface as 409, not 500.
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  /**
   * Authenticates (or provisions) an account from a verified Google ID token.
   * Resolution order, first match wins:
   *   1. googleId already on a row  → returning Google login.
   *   2. verified email matches a row → auto-link Google to that account.
   *   3. a valid guest bearer token   → upgrade that guest row in place.
   *   4. otherwise                     → create a brand-new full account.
   * Never creates a password; a Google-only account has passwordHash = null.
   */
  async googleAuth(dto: GoogleAuthDto, bearerToken?: string): Promise<AuthResponseDto> {
    const { sub, email, displayName } = await this.verifyGoogleIdToken(dto.idToken);

    // Validate any referral code up front (M20.3): an invalid code is a 400
    // regardless of the sign-in outcome. It is only *attributed* below when this
    // sign-in creates a new account or upgrades a guest — never for a returning
    // user or an auto-linked existing account (they already registered).
    const referrerId = dto.referralCode
      ? await this.referrals.resolveReferrer(
          dto.referralCode,
          this.resolveGuestUserId(bearerToken) ?? undefined,
        )
      : null;

    // 1. Returning Google user — the googleId is the stable identity. isGuest is
    // never true on such a row (only step 2/3 set googleId and both clear it),
    // but pass user.isGuest through defensively rather than special-casing.
    // A soft-deleted row (deletedAt set) must not authenticate, matching
    // login()/refresh()/getProfile() — treat it as if the googleId weren't
    // taken, falling through to auto-link/guest-upgrade/new-account below.
    const byGoogleId = await this.prisma.user.findUnique({ where: { googleId: sub } });
    if (byGoogleId && !byGoogleId.deletedAt) {
      const tokens = await this.persistTokens(byGoogleId.id, byGoogleId.isGuest);
      return { ...tokens, user: await this.toProfile(byGoogleId) };
    }

    try {
      // 2. Auto-link: an existing account (password-based or otherwise) owns this
      // verified email. The email match is authoritative. Never overwrite a
      // user-set displayName, and never touch passwordHash. Same deletedAt
      // exclusion as step 1 — a soft-deleted account's email must not
      // auto-link; fall through to guest-upgrade/new-account instead.
      // Fold the fresh refreshTokenHash into the same write as steps 3/4,
      // rather than a separate persistTokens() call, so the link and the
      // token-hash rotation can't land as two independently-failable writes.
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail && !byEmail.deletedAt) {
        const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(
          byEmail.id,
          false,
        );
        const linked = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: sub,
            isGuest: false,
            displayName: byEmail.displayName ?? displayName,
            refreshTokenHash,
          },
        });
        this.logger.log(`Existing account ${linked.id} linked to Google`);
        return { accessToken, refreshToken, user: await this.toProfile(linked) };
      }

      // 3. Guest upgrade in place — mirrors signup()'s guest branch so mission/XP
      // history carries over. Fold the fresh refreshTokenHash into the same write.
      const guestUserId = this.resolveGuestUserId(bearerToken);
      if (guestUserId) {
        const guest = await this.prisma.user.findUnique({ where: { id: guestUserId } });
        if (guest && guest.isGuest && !guest.deletedAt) {
          const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(
            guest.id,
            false,
          );
          const upgraded = await this.prisma.user.update({
            where: { id: guest.id },
            data: {
              email,
              googleId: sub,
              displayName: guest.displayName ?? displayName,
              isGuest: false,
              refreshTokenHash,
            },
          });
          this.logger.log(`Guest ${guest.id} upgraded to full account via Google`);
          await this.attributeReferral(referrerId, dto.referralCode, upgraded.id);
          return { accessToken, refreshToken, user: await this.toProfile(upgraded) };
        }
      }

      // 4. Brand-new account. No password is ever set for a Google-first user.
      const id = randomUUID();
      const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(id, false);
      const created = await this.prisma.user.create({
        data: {
          id,
          email,
          googleId: sub,
          displayName,
          isGuest: false,
          passwordHash: null,
          refreshTokenHash,
        },
      });
      this.logger.log(`New account created via Google: ${id}`);
      await this.attributeReferral(referrerId, dto.referralCode, created.id);
      return { accessToken, refreshToken, user: await this.toProfile(created) };
    } catch (error) {
      // Backstop for the race between the read-checks above and the write: a
      // concurrent Google sign-in on the same email should look like "try
      // again", not a 409 email-taken signal (the user isn't choosing an email
      // in an OAuth flow), so re-throw as the same generic auth failure.
      if (this.isUniqueConstraintViolation(error)) {
        throw new UnauthorizedException(GENERIC_GOOGLE_AUTH_ERROR);
      }
      throw error;
    }
  }

  /** Authenticates by email + password. Same generic error for every failure. */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // A suspended account (Phase 8) is treated exactly like a deleted/unknown one
    // on the login path: no fresh token pair is issued, and the same generic,
    // enumeration-resistant error is returned so suspension status doesn't leak.
    if (!user || !user.passwordHash || user.deletedAt || user.suspendedAt) {
      // Same-cost dummy compare so a missing/passwordless account takes the
      // same wall-clock time as a real one — see DUMMY_BCRYPT_HASH comment.
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    const tokens = await this.persistTokens(user.id, user.isGuest);
    return { ...tokens, user: await this.toProfile(user) };
  }

  /** Exchanges a valid refresh token for a new pair and rotates the stored hash. */
  async refresh(dto: RefreshTokenDto): Promise<AuthResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.refreshToken, {
        secret: this.jwtSecret,
      });
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH_ERROR);
    }

    if (payload.type !== TokenType.Refresh) {
      throw new UnauthorizedException(INVALID_REFRESH_ERROR);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    // A suspended account (Phase 8) cannot rotate into a fresh access token. The
    // suspend action nulls `refreshTokenHash` too, so the `!user.refreshTokenHash`
    // clause already covers the common case; the explicit `suspendedAt` check is
    // belt-and-suspenders against any token minted before the hash was cleared.
    if (!user || !user.refreshTokenHash || user.deletedAt || user.suspendedAt) {
      throw new UnauthorizedException(INVALID_REFRESH_ERROR);
    }

    const tokenMatches = await bcrypt.compare(this.digest(dto.refreshToken), user.refreshTokenHash);
    if (!tokenMatches) {
      throw new UnauthorizedException(INVALID_REFRESH_ERROR);
    }

    const tokens = await this.persistTokens(user.id, user.isGuest);
    return { ...tokens, user: await this.toProfile(user) };
  }

  /**
   * Revokes the caller's server-side refresh token by nulling `refreshTokenHash`.
   * A subsequent `/auth/refresh` with the now-orphaned token is rejected by the
   * `!user.refreshTokenHash` guard in `refresh()` — closing the window where a
   * refresh token captured before logout stays valid until natural expiry.
   *
   * Idempotent: the caller is already authenticated (JwtAuthGuard + JwtStrategy
   * confirmed the row exists and is not soft-deleted), so a plain update is safe;
   * re-nulling an already-null hash is a no-op that still returns success.
   */
  async logout(userId: string, pushToken?: string): Promise<LogoutResponseDto> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
    this.logger.log(`Refresh token revoked on logout: ${userId}`);

    // M21.3 — deregister the device's push token so a shared device stops
    // receiving this user's pushes after logout, matching the rigor of the
    // refresh-token revocation above. Isolated in its own try/catch so a
    // notification-side failure can never turn a successful logout into a 500
    // (the same isolation the referral/notification hooks use elsewhere).
    if (pushToken) {
      try {
        await this.notifications.deregisterPushToken(userId, pushToken);
      } catch (error) {
        this.logger.error(
          `Push-token deregistration failed on logout for user ${userId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return { success: true };
  }

  /** Returns the public-safe profile of the authenticated user. */
  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }
    return this.toProfile(user);
  }

  /**
   * Updates the authenticated user's display name and returns the refreshed
   * profile. The caller is already authenticated (JwtAuthGuard + JwtStrategy
   * confirmed the row exists and is not soft-deleted), so a plain update mirrors
   * logout()'s trust model rather than re-reading first.
   */
  async updateDisplayName(userId: string, displayName: string): Promise<UserProfileDto> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName },
    });
    this.logger.log(`Display name updated for user ${userId}`);
    return this.toProfile(updated);
  }

  /**
   * Changes a password account's password (M22.1). bcrypt-verifies the supplied
   * current password against the stored hash using the exact BCRYPT_ROUNDS cost
   * factor login() uses, then stores a fresh hash. A guest or Google-only account
   * (no `passwordHash`) gets a distinct, clear error rather than a confusing
   * "wrong password" — there is no password to compare against.
   *
   * The caller is already authenticated (JwtAuthGuard + JwtStrategy confirmed the
   * row exists and is not soft-deleted), but re-reads here because the write needs
   * the current `passwordHash` the JWT payload does not carry. The refresh token
   * IS revoked on a successful change (independent review flagged the earlier
   * "don't revoke, avoid surprising UX" choice as weak for a security-motivated
   * action: this app stores a single refresh-token hash per user, so an attacker
   * holding the current refresh token would otherwise stay authenticated —
   * indefinitely rotating into fresh access tokens — straight through the very
   * password change meant to lock them out). The acting device re-logs in with
   * the new password, same as any other device; the minor friction is the point.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<ChangePasswordResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      // Defensive: JwtStrategy already rejects tokens for deleted/missing users.
      throw new UnauthorizedException('User not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException(NO_PASSWORD_ACCOUNT_ERROR);
    }

    const currentMatches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, refreshTokenHash: null },
    });
    this.logger.log(`Password changed for user ${userId}; refresh token revoked`);
    return { success: true };
  }

  /**
   * Soft-deletes and anonymizes the authenticated user's account (M22.2,
   * Decision 7). This is destructive-feeling, so it requires re-authentication in
   * the request: a password account must supply the correct current password; a
   * Google-only / guest account (no `passwordHash`) must instead confirm intent
   * (`confirm: true`), since there is no password to verify.
   *
   * On success, in a single transaction: sets `deletedAt`, revokes
   * `refreshTokenHash`, scrubs the display identity (`displayName` ->
   * "Deleted User", `avatarUrl` cleared), and de-references every proof/evidence
   * media pointer this user owns (`Completion.proofKey`, their submissions'
   * `UserTaskAttachment.objectKey`). `email`/`googleId`/`passwordHash` are left
   * intact — the unique email/googleId stay taken and are NOT released for
   * re-registration in v1.
   *
   * The actual S3 object deletion and push-token deregistration happen AFTER the
   * commit, best-effort and isolated per the UsersService avatar-delete pattern
   * (DB pointer nulled first, S3 delete second) — so a storage/notification-side
   * failure can never turn an already-committed soft-delete into a 500.
   *
   * The caller's existing access token stops working immediately: JwtStrategy
   * rejects tokens for `deletedAt`-set users, so no parallel revocation is needed.
   * Rewards already granted to counterparties are untouched (this method only
   * writes the deleting user's own rows), so they are never clawed back.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<DeleteAccountResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      // Defensive: JwtStrategy already rejects tokens for deleted/missing users.
      throw new UnauthorizedException('User not found');
    }

    // Re-authentication gate.
    if (user.passwordHash) {
      if (!dto.currentPassword) {
        throw new BadRequestException('currentPassword is required to delete this account');
      }
      const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!matches) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    } else if (dto.confirm !== true) {
      throw new BadRequestException(
        'This account has no password; set confirm=true to confirm account deletion',
      );
    }

    await this.anonymizeUserAccount(userId, user.avatarUrl);
    return { success: true };
  }

  /**
   * The reusable core of account deletion (Phase 8): soft-delete + anonymize +
   * de-reference media, then best-effort S3/push cleanup. Extracted from
   * `deleteAccount` so an admin-initiated deletion request (`DELETE
   * /admin/users/:id`) applies the *exact same* anonymization as the self-service
   * flow rather than duplicating it — the only difference between the two is the
   * caller-side gate (self-service re-auths the user; the admin path is
   * permission-gated + audited). Caller is responsible for confirming the row
   * exists and is not already deleted before invoking this.
   *
   * `avatarKey` is passed in (rather than re-read) so this method makes no extra
   * `user.findUnique` round trip — the caller already has the row in hand.
   */
  async anonymizeUserAccount(userId: string, avatarKey: string | null): Promise<void> {
    // Soft-delete + anonymize + de-reference media pointers atomically. Media
    // keys are collected before nulling so the S3 objects can be cleaned up
    // after the commit.
    const mediaKeys = await this.prisma.$transaction(async (tx) => {
      const [completions, attachments] = await Promise.all([
        tx.completion.findMany({
          where: { userId, proofKey: { not: null } },
          select: { proofKey: true },
        }),
        tx.userTaskAttachment.findMany({
          where: { submission: { submittedById: userId }, objectKey: { not: null } },
          select: { id: true, objectKey: true },
        }),
      ]);

      const proofKeys = completions.map((c) => c.proofKey).filter((k): k is string => k !== null);
      const attachmentIds = attachments.map((a) => a.id);
      const attachmentKeys = attachments
        .map((a) => a.objectKey)
        .filter((k): k is string => k !== null);

      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          refreshTokenHash: null,
          displayName: DELETED_DISPLAY_NAME,
          avatarUrl: null,
        },
      });
      if (proofKeys.length > 0) {
        await tx.completion.updateMany({
          where: { userId, proofKey: { not: null } },
          data: { proofKey: null },
        });
      }
      if (attachmentIds.length > 0) {
        await tx.userTaskAttachment.updateMany({
          where: { id: { in: attachmentIds } },
          data: { objectKey: null },
        });
      }

      return [...(avatarKey ? [avatarKey] : []), ...proofKeys, ...attachmentKeys];
    });

    this.logger.log(`Account soft-deleted and anonymized: ${userId}`);

    // Best-effort S3 cleanup — DB pointers are already nulled above, mirroring
    // UsersService.deleteAvatar so a storage failure only ever orphans an object
    // (logged), never leaves a live pointer to deleted media. Each delete is
    // isolated so one failure does not abort the rest.
    for (const key of mediaKeys) {
      try {
        await this.storage.deleteObject(key);
      } catch (error) {
        this.logger.warn(
          `Failed to delete object ${key} for deleted user ${userId}: ` +
            (error instanceof Error ? error.message : 'unknown error'),
        );
      }
    }

    // Deregister every device push token (Decision 7). Isolated in its own
    // try/catch so a notification-side failure can never turn an already-
    // committed soft-delete into a 500 — the same isolation logout() uses.
    try {
      await this.notifications.deregisterAllPushTokens(userId);
    } catch (error) {
      this.logger.error(
        `Push-token deregistration failed for deleted user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Signs a fresh access/refresh pair for `userId` without touching the
   * database. Kept separate from persistence so every call site can fold the
   * `refreshTokenHash` write into its own single create/update — never a
   * second round trip that could leave a user row without a usable token pair
   * if it failed independently.
   */
  private async buildTokenSet(userId: string, isGuest: boolean): Promise<TokenSet> {
    const accessPayload: JwtPayload = { sub: userId, isGuest, type: TokenType.Access };
    const refreshPayload: JwtPayload = {
      sub: userId,
      isGuest,
      type: TokenType.Refresh,
      jti: randomUUID(),
    };

    const accessToken = await this.jwtService.signAsync(
      accessPayload,
      this.signOptions(this.accessTtl),
    );
    const refreshToken = await this.jwtService.signAsync(
      refreshPayload,
      this.signOptions(isGuest ? this.guestRefreshTtl : this.refreshTtl),
    );
    const refreshTokenHash = await bcrypt.hash(this.digest(refreshToken), BCRYPT_ROUNDS);

    return { accessToken, refreshToken, refreshTokenHash };
  }

  /** Builds a token set and persists its hash in a single write against an existing user. */
  private async persistTokens(userId: string, isGuest: boolean): Promise<AuthTokensDto> {
    const { accessToken, refreshToken, refreshTokenHash } = await this.buildTokenSet(
      userId,
      isGuest,
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });
    return { accessToken, refreshToken };
  }

  /**
   * Records a referral conversion once the referee's account exists (M20.3).
   * The code was already validated up front by `resolveReferrer`, so
   * `referrerId` is trusted here; a no-op when no code was supplied. Delegates
   * the (idempotent) write to ReferralsService so all referral persistence
   * stays in one module.
   *
   * Isolated in its own try/catch — mirroring the same isolation
   * ProofService/TasksService apply around their ReferralsService calls — so
   * a transient failure here (e.g. a dropped DB connection) can never turn
   * into a 500 for a signup/googleAuth call whose account write has *already
   * committed*. Without this, the caller's outer catch would see a non-P2002
   * error, rethrow it as a 500, and leave the user with a real account they
   * can't re-signup into (email now taken) and a permanently unattributed
   * referral — worse than just logging and moving on.
   */
  private async attributeReferral(
    referrerId: string | null,
    code: string | undefined,
    refereeId: string,
  ): Promise<void> {
    if (!referrerId || !code) {
      return;
    }
    try {
      await this.referrals.attributeSignup({ refereeId, referrerId, code });
    } catch (error) {
      this.logger.error(
        `Referral attribution failed for referee ${refereeId} (code ${code})`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * If the bearer token is a valid guest access token, returns its user id so
   * signup can upgrade that row in place. Returns null for any non-guest,
   * non-access, expired, or malformed token (falling back to fresh signup).
   */
  private resolveGuestUserId(bearerToken?: string): string | null {
    if (!bearerToken) {
      return null;
    }
    const raw = bearerToken.startsWith('Bearer ')
      ? bearerToken.slice('Bearer '.length)
      : bearerToken;
    try {
      const payload = this.jwtService.verify<JwtPayload>(raw, {
        secret: this.jwtSecret,
      });
      if (payload.type !== TokenType.Access || !payload.isGuest) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  /**
   * Verifies a Google ID token's signature and audience via google-auth-library
   * (never a hand-rolled decode) and returns the claims we trust. Every failure
   * mode — bad signature, wrong audience, unverified email, or missing sub/email
   * — collapses to the same generic UnauthorizedException so nothing about which
   * check failed leaks to the caller, and no DB write is attempted.
   */
  private async verifyGoogleIdToken(
    idToken: string,
  ): Promise<{ sub: string; email: string; displayName: string | null }> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: [this.googleWebClientId, this.googleIosClientId],
      });
      const payload = ticket.getPayload();
      if (!payload || payload.email_verified !== true || !payload.sub || !payload.email) {
        throw new UnauthorizedException(GENERIC_GOOGLE_AUTH_ERROR);
      }
      return { sub: payload.sub, email: payload.email, displayName: payload.name ?? null };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(GENERIC_GOOGLE_AUTH_ERROR);
    }
  }

  /** Builds sign options with the secret and a `ms`-style TTL from config. */
  private signOptions(expiresIn: string): JwtSignOptions {
    return {
      secret: this.jwtSecret,
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    };
  }

  /**
   * True when a Prisma write failed the unique constraint on `email` or
   * `googleId`. `signup()` only ever races on `email`; `googleAuth()` can
   * race on either (two concurrent sign-ins for the same Google `sub`, or
   * the same email) — checking both fields is a no-op for signup()'s own
   * writes since a `googleId` violation can't occur there.
   */
  private isUniqueConstraintViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target as string[] | undefined;
    return target?.includes('email') === true || target?.includes('googleId') === true;
  }

  /** SHA-256 the (long) JWT before bcrypt to sidestep bcrypt's 72-byte input cap. */
  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Projects a User row to the public-safe profile, resolving `avatarUrl` from a
   * stored S3 object key to a short-lived presigned GET URL (null when unset) —
   * the same read-time-resolution convention ProofService uses for `proofUrl`,
   * so the raw key is never exposed. Async because the presign is an I/O call;
   * every call site awaits it.
   */
  private async toProfile(user: User): Promise<UserProfileDto> {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isGuest: user.isGuest,
      avatarUrl: user.avatarUrl ? await this.storage.getSignedDownloadUrl(user.avatarUrl) : null,
    };
  }
}
