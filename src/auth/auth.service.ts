import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
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
    return { accessToken, refreshToken, user: this.toProfile(user) };
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

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const guestUserId = this.resolveGuestUserId(bearerToken);

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
          return { accessToken, refreshToken, user: this.toProfile(upgraded) };
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
      return { accessToken, refreshToken, user: this.toProfile(created) };
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

    // 1. Returning Google user — the googleId is the stable identity. isGuest is
    // never true on such a row (only step 2/3 set googleId and both clear it),
    // but pass user.isGuest through defensively rather than special-casing.
    // A soft-deleted row (deletedAt set) must not authenticate, matching
    // login()/refresh()/getProfile() — treat it as if the googleId weren't
    // taken, falling through to auto-link/guest-upgrade/new-account below.
    const byGoogleId = await this.prisma.user.findUnique({ where: { googleId: sub } });
    if (byGoogleId && !byGoogleId.deletedAt) {
      const tokens = await this.persistTokens(byGoogleId.id, byGoogleId.isGuest);
      return { ...tokens, user: this.toProfile(byGoogleId) };
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
        return { accessToken, refreshToken, user: this.toProfile(linked) };
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
          return { accessToken, refreshToken, user: this.toProfile(upgraded) };
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
      return { accessToken, refreshToken, user: this.toProfile(created) };
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
    if (!user || !user.passwordHash || user.deletedAt) {
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
    return { ...tokens, user: this.toProfile(user) };
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
    if (!user || !user.refreshTokenHash || user.deletedAt) {
      throw new UnauthorizedException(INVALID_REFRESH_ERROR);
    }

    const tokenMatches = await bcrypt.compare(this.digest(dto.refreshToken), user.refreshTokenHash);
    if (!tokenMatches) {
      throw new UnauthorizedException(INVALID_REFRESH_ERROR);
    }

    const tokens = await this.persistTokens(user.id, user.isGuest);
    return { ...tokens, user: this.toProfile(user) };
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
  async logout(userId: string): Promise<LogoutResponseDto> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
    this.logger.log(`Refresh token revoked on logout: ${userId}`);
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

  private toProfile(user: User): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isGuest: user.isGuest,
    };
  }
}
