import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SignupDto } from './dto/signup.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { JwtPayload, TokenType } from './types/jwt-payload.interface';

const BCRYPT_ROUNDS = 12;
/** Deliberately identical for unknown-email and wrong-password to avoid enumeration. */
const GENERIC_AUTH_ERROR = 'Invalid email or password';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.getOrThrow<string>('JWT_SECRET');
    this.accessTtl = config.getOrThrow<string>('JWT_ACCESS_TOKEN_TTL');
    this.refreshTtl = config.getOrThrow<string>('JWT_REFRESH_TOKEN_TTL');
    this.guestRefreshTtl = config.getOrThrow<string>('GUEST_TOKEN_TTL');
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
      if (this.isUniqueEmailViolation(error)) {
        throw new ConflictException('Email already registered');
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

  /** Builds sign options with the secret and a `ms`-style TTL from config. */
  private signOptions(expiresIn: string): JwtSignOptions {
    return {
      secret: this.jwtSecret,
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    };
  }

  /** True when a Prisma write failed the unique constraint on `email`. */
  private isUniqueEmailViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (error.meta?.target as string[] | undefined)?.includes('email') === true
    );
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
