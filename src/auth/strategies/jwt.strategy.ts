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

    return { userId: user.id, email: user.email, isGuest: user.isGuest };
  }
}
