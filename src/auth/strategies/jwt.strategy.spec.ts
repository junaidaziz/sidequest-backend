import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtPayload, TokenType } from '../types/jwt-payload.interface';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: 'hash',
    refreshTokenHash: null,
    googleId: null,
    displayName: 'Ada',
    avatarUrl: null,
    stripeCustomerId: null,
    isGuest: false,
    totalXp: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastCompletionDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };

  const accessPayload: JwtPayload = { sub: 'user-1', isGuest: false, type: TokenType.Access };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    const config = { getOrThrow: (): string => 'test-secret' } as unknown as ConfigService;
    strategy = new JwtStrategy(config, prisma as unknown as PrismaService);
  });

  it('returns the AuthUser for a valid access token', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser());

    await expect(strategy.validate(accessPayload)).resolves.toEqual({
      userId: 'user-1',
      email: 'ada@example.com',
      isGuest: false,
    });
  });

  it('rejects refresh tokens presented as access tokens', async () => {
    await expect(
      strategy.validate({ ...accessPayload, type: TokenType.Refresh }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects tokens for users that no longer exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(accessPayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens for soft-deleted users', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));

    await expect(strategy.validate(accessPayload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
