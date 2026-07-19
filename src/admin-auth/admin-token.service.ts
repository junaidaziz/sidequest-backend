import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AdminJwtPayload, AdminTokenType } from './types/admin-jwt-payload.interface';

const BCRYPT_ROUNDS = 12;
/** Explicitly pinned — closes W5 (JWT algorithm not pinned) for the admin surface. */
const ALGORITHM = 'HS256' as const;

/** A freshly-signed admin token pair plus the material needed to persist a session. */
export interface AdminTokenSet {
  accessToken: string;
  refreshToken: string;
  refreshTokenHash: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Signs and verifies admin JWTs with the admin-only secret (ADMIN_JWT_SECRET),
 * separate from the user-auth JWT_SECRET so the two surfaces share nothing. Every
 * token embeds an AdminSession id (`sid`) so the strategy can enforce per-request
 * revocation.
 */
@Injectable()
export class AdminTokenService {
  private readonly secret: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('ADMIN_JWT_SECRET');
    this.accessTtl = config.get<string>('ADMIN_JWT_ACCESS_TOKEN_TTL') ?? '15m';
    this.refreshTtl = config.get<string>('ADMIN_JWT_REFRESH_TOKEN_TTL') ?? '12h';
  }

  /**
   * Builds a token pair for a session. `sessionId` is generated up front (not
   * read back from the DB) so the refresh-token hash and the session row can be
   * written in a single insert — no second round trip that could orphan a token.
   */
  async issue(adminUserId: string, sessionId: string = randomUUID()): Promise<AdminTokenSet> {
    const accessPayload: AdminJwtPayload = {
      sub: adminUserId,
      sid: sessionId,
      type: AdminTokenType.Access,
    };
    const refreshPayload: AdminJwtPayload = {
      sub: adminUserId,
      sid: sessionId,
      type: AdminTokenType.Refresh,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, this.signOptions(this.accessTtl));
    const refreshToken = await this.jwt.signAsync(
      refreshPayload,
      this.signOptions(this.refreshTtl),
    );
    const refreshTokenHash = await bcrypt.hash(this.digest(refreshToken), BCRYPT_ROUNDS);

    return {
      accessToken,
      refreshToken,
      refreshTokenHash,
      sessionId,
      expiresAt: this.refreshExpiry(),
    };
  }

  /** Verifies a refresh token's signature/expiry and asserts it is a refresh token. */
  async verifyRefresh(token: string): Promise<AdminJwtPayload> {
    const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
      secret: this.secret,
      algorithms: [ALGORITHM],
    });
    if (payload.type !== AdminTokenType.Refresh) {
      throw new Error('Not a refresh token');
    }
    return payload;
  }

  /** True when `token` matches the stored bcrypt hash for a session's refresh token. */
  compareRefresh(token: string, hash: string): Promise<boolean> {
    return bcrypt.compare(this.digest(token), hash);
  }

  /** Sign options with the admin secret, pinned HS256 algorithm, and a `ms`-style TTL. */
  private signOptions(expiresIn: string): JwtSignOptions {
    return {
      secret: this.secret,
      algorithm: ALGORITHM,
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    };
  }

  /** SHA-256 the (long) JWT before bcrypt to sidestep bcrypt's 72-byte input cap. */
  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Refresh-token absolute expiry, mirroring the signed TTL, for the session row. */
  private refreshExpiry(): Date {
    return new Date(Date.now() + this.ttlToMs(this.refreshTtl));
  }

  /** Parses a `ms`-style TTL (e.g. "12h", "30d", "900s") to milliseconds. */
  private ttlToMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) {
      // Fall back to 12h for an unparseable value rather than NaN.
      return 12 * 60 * 60 * 1000;
    }
    const value = Number(match[1]);
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] ?? 3_600_000;
    return value * unit;
  }
}
