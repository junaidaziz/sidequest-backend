import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser, JwtPayload, TokenType } from '../types/jwt-payload.interface';

/**
 * Validates access tokens on every JwtAuthGuard-protected route. Rejects refresh
 * tokens (wrong `type`) and tokens for users that no longer exist or were deleted.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      // Pin the accepted signing algorithm (closes security finding W5 — JWT
      // algorithm not pinned). Without this a token forged with `alg: none` or a
      // downgraded algorithm could be accepted. HS256 is what AuthService signs with.
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== TokenType.Access) {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User no longer exists');
    }
    // Admin suspension (Phase 8) is enforced here, on every request, exactly like
    // the soft-delete check above: a non-null `suspendedAt` rejects the caller's
    // existing (still-unexpired) access token on its very next use, so an admin
    // suspend takes effect immediately with no token-revocation bookkeeping. The
    // suspend action also nulls `refreshTokenHash`, so the refresh path can't mint
    // a fresh access token to route around this.
    if (user.suspendedAt) {
      throw new UnauthorizedException('Account suspended');
    }

    return { userId: user.id, email: user.email, isGuest: user.isGuest };
  }
}
