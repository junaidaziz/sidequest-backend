import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminJwtPayload, AdminTokenType, AuthAdmin } from '../types/admin-jwt-payload.interface';

/** Avoid turning every authenticated read into a session-row write. */
const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Second, separately-named Passport strategy ('admin-jwt') registered ALONGSIDE
 * the existing unnamed 'jwt' strategy — zero collision, own secret, own payload.
 * `algorithms: ['HS256']` is pinned explicitly (closes W5).
 *
 * Per-request revocation (closes W2 for admins): every request re-reads the
 * AdminSession named by the token's `sid` claim and rejects it if the session is
 * revoked or expired, or if the admin is deleted/suspended/locked — the same
 * "re-read from the DB, never trust the token blindly" model the user JwtStrategy
 * uses, extended to real multi-session forced logout.
 *
 * `mfaPending` / `mustChangePassword` are derived fresh from the DB here (not
 * carried in the token) so enrolling MFA or changing the password takes effect on
 * the very next request with no re-issue.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('ADMIN_JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AdminJwtPayload): Promise<AuthAdmin> {
    if (payload.type !== AdminTokenType.Access) {
      throw new UnauthorizedException('Invalid token type');
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sid },
      include: { adminUser: { include: { role: true } } },
    });

    if (!session || session.adminUserId !== payload.sub) {
      throw new UnauthorizedException('Session not found');
    }
    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session revoked or expired');
    }

    const admin = session.adminUser;
    if (admin.deletedAt || admin.status === 'Suspended') {
      throw new UnauthorizedException('Admin account is not active');
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Admin account is locked');
    }

    // Touch lastUsedAt best-effort, at most once per five-minute activity
    // window. The conditional update is concurrency-safe: a burst of parallel
    // requests can produce at most one effective row change.
    const activityCutoff = new Date(Date.now() - SESSION_ACTIVITY_TOUCH_INTERVAL_MS);
    this.prisma.adminSession
      .updateMany({
        where: {
          id: session.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: activityCutoff } }],
        },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);

    return {
      adminUserId: admin.id,
      email: admin.email,
      roleId: admin.roleId,
      sessionId: session.id,
      mfaPending: admin.role.mfaRequired && admin.mfaEnabledAt === null,
      mustChangePassword: admin.mustChangePassword,
    };
  }
}
