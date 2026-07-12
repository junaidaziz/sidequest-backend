import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenType } from './types/jwt-payload.interface';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const bcryptHash = bcrypt.hash as jest.Mock;
const bcryptCompare = bcrypt.compare as jest.Mock;

const CONFIG: Record<string, string> = {
  JWT_SECRET: 'test-secret',
  JWT_ACCESS_TOKEN_TTL: '15m',
  JWT_REFRESH_TOKEN_TTL: '30d',
  GUEST_TOKEN_TTL: '90d',
};

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: 'hashed-password',
    refreshTokenHash: null,
    displayName: 'Ada',
    isGuest: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let jwtService: {
    signAsync: jest.Mock;
    verify: jest.Mock;
    verifyAsync: jest.Mock;
  };

  beforeEach(async () => {
    bcryptHash.mockReset().mockResolvedValue('bcrypt-hash');
    bcryptCompare.mockReset().mockResolvedValue(false);
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(buildUser()),
      },
    };
    jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      verify: jest.fn(),
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string): string => CONFIG[key] },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createGuest', () => {
    it('creates a guest user and returns a token pair', async () => {
      prisma.user.create.mockResolvedValue(buildUser({ isGuest: true, email: null }));

      const result = await service.createGuest();

      // Single write: id is generated up front so refreshTokenHash can be
      // folded into the same create() call — no separate update() round trip
      // that could leave a user row without a usable token pair if it failed.
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          isGuest: true,
          refreshTokenHash: expect.any(String),
        }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      // Profile comes from create()'s own return value — no extra read.
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1', email: null, displayName: 'Ada', isGuest: true },
      });
    });

    it('signs the guest refresh token with the guest TTL', async () => {
      prisma.user.create.mockResolvedValue(buildUser({ isGuest: true, email: null }));

      await service.createGuest();

      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ type: TokenType.Refresh }),
        expect.objectContaining({ expiresIn: '90d' }),
      );
    });
  });

  describe('signup', () => {
    it('throws ConflictException when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(buildUser());

      await expect(
        service.signup({ email: 'ada@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a fresh account when no guest token is supplied', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue(buildUser());
      bcryptHash.mockResolvedValue('bcrypt-hash');

      const result = await service.signup({
        email: 'ada@example.com',
        password: 'password123',
        displayName: 'Ada',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          email: 'ada@example.com',
          passwordHash: 'bcrypt-hash',
          displayName: 'Ada',
          isGuest: false,
          refreshTokenHash: expect.any(String),
        }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('access-token');
    });

    it('defaults displayName to null when omitted', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue(buildUser());
      bcryptHash.mockResolvedValue('bcrypt-hash');

      await service.signup({ email: 'ada@example.com', password: 'password123' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ displayName: null }) }),
      );
    });

    it('upgrades an existing guest in place when a valid guest token is supplied', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // email uniqueness check
        .mockResolvedValueOnce(
          buildUser({ id: 'guest-1', isGuest: true, email: null, displayName: null }),
        );
      prisma.user.update.mockResolvedValue(buildUser({ id: 'guest-1', isGuest: false }));
      bcryptHash.mockResolvedValue('bcrypt-hash');
      jwtService.verify.mockReturnValue({ sub: 'guest-1', isGuest: true, type: TokenType.Access });

      const result = await service.signup(
        { email: 'ada@example.com', password: 'password123', displayName: 'Ada' },
        'Bearer guest-access-token',
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'guest-1' },
          data: expect.objectContaining({ email: 'ada@example.com', isGuest: false }),
        }),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('access-token');
    });

    it('falls back to a fresh account when the bearer token is not a guest token', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue(buildUser());
      bcryptHash.mockResolvedValue('bcrypt-hash');
      jwtService.verify.mockReturnValue({ sub: 'u2', isGuest: false, type: TokenType.Access });

      await service.signup(
        { email: 'ada@example.com', password: 'password123' },
        'Bearer non-guest-token',
      );

      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('falls back to a fresh account when the guest token is malformed', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue(buildUser());
      bcryptHash.mockResolvedValue('bcrypt-hash');
      jwtService.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      await service.signup({ email: 'ada@example.com', password: 'password123' }, 'Bearer garbage');

      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('falls back to a fresh account when the referenced guest no longer qualifies', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // email uniqueness
        .mockResolvedValueOnce(buildUser({ id: 'guest-1', isGuest: false })); // already upgraded
      prisma.user.create.mockResolvedValue(buildUser());
      bcryptHash.mockResolvedValue('bcrypt-hash');
      jwtService.verify.mockReturnValue({ sub: 'guest-1', isGuest: true, type: TokenType.Access });

      await service.signup(
        { email: 'ada@example.com', password: 'password123' },
        'Bearer guest-access-token',
      );

      expect(prisma.user.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'guest-1' },
          data: expect.objectContaining({ email: 'ada@example.com' }),
        }),
      );
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('accepts a raw (non-"Bearer " prefixed) guest token and preserves the guest displayName', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // email uniqueness
        .mockResolvedValueOnce(
          buildUser({ id: 'guest-1', isGuest: true, email: null, displayName: 'GuestName' }),
        );
      prisma.user.update.mockResolvedValue(buildUser({ id: 'guest-1', isGuest: false }));
      jwtService.verify.mockReturnValue({ sub: 'guest-1', isGuest: true, type: TokenType.Access });

      await service.signup(
        { email: 'ada@example.com', password: 'password123' }, // no displayName
        'raw-guest-token', // no "Bearer " prefix
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'guest-1' },
          data: expect.objectContaining({ displayName: 'GuestName', isGuest: false }),
        }),
      );
    });

    it('maps a P2002 email unique-constraint race to ConflictException (409)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null); // pre-check passes
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        }),
      );

      await expect(
        service.signup({ email: 'ada@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws non-unique-constraint database errors unchanged', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const dbError = new Error('connection lost');
      prisma.user.create.mockRejectedValue(dbError);

      await expect(
        service.signup({ email: 'ada@example.com', password: 'password123' }),
      ).rejects.toBe(dbError);
    });
  });

  describe('login', () => {
    it('returns tokens on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(true);

      const result = await service.login({ email: 'ada@example.com', password: 'password123' });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada', isGuest: false },
      });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('still runs a dummy bcrypt.compare when the email is unknown, to avoid a timing side-channel', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service
        .login({ email: 'nobody@example.com', password: 'password123' })
        .catch(() => undefined);

      // A real compare must run even on the fast-exit path, or response
      // timing alone would reveal whether the email exists in the database.
      expect(bcryptCompare).toHaveBeenCalledWith('password123', expect.any(String));
    });

    it('throws UnauthorizedException when the user has no password (guest row)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash: null }));

      await expect(
        service.login({ email: 'ada@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when the account is soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));

      await expect(
        service.login({ email: 'ada@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(false);

      await expect(
        service.login({ email: 'ada@example.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('uses the same generic message for unknown email and wrong password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknownEmail = await service
        .login({ email: 'x@example.com', password: 'password123' })
        .catch((e: UnauthorizedException) => e.message);

      prisma.user.findUnique.mockResolvedValueOnce(buildUser());
      bcryptCompare.mockResolvedValue(false);
      const wrongPassword = await service
        .login({ email: 'ada@example.com', password: 'wrong' })
        .catch((e: UnauthorizedException) => e.message);

      expect(unknownEmail).toBe(wrongPassword);
    });
  });

  describe('refresh', () => {
    it('rotates tokens for a valid refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        isGuest: false,
        type: TokenType.Refresh,
      });
      prisma.user.findUnique.mockResolvedValue(buildUser({ refreshTokenHash: 'stored-hash' }));
      bcryptCompare.mockResolvedValue(true);

      const result = await service.refresh({ refreshToken: 'valid.refresh.token' });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1', email: 'ada@example.com', displayName: 'Ada', isGuest: false },
      });
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('throws when the refresh token signature is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(service.refresh({ refreshToken: 'bad' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws when the token is an access token, not a refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        isGuest: false,
        type: TokenType.Access,
      });

      await expect(service.refresh({ refreshToken: 'access.as.refresh' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws when the user is gone or has no stored refresh hash', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        isGuest: false,
        type: TokenType.Refresh,
      });
      prisma.user.findUnique.mockResolvedValue(buildUser({ refreshTokenHash: null }));

      await expect(service.refresh({ refreshToken: 'valid.refresh.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws when the presented token does not match the stored hash', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        isGuest: false,
        type: TokenType.Refresh,
      });
      prisma.user.findUnique.mockResolvedValue(buildUser({ refreshTokenHash: 'stored-hash' }));
      bcryptCompare.mockResolvedValue(false);

      await expect(service.refresh({ refreshToken: 'stale.refresh.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('getProfile', () => {
    it('returns the public-safe profile without secret fields', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordHash: 'secret', refreshTokenHash: 'secret' }),
      );

      const profile = await service.getProfile('user-1');

      expect(profile).toEqual({
        id: 'user-1',
        email: 'ada@example.com',
        displayName: 'Ada',
        isGuest: false,
      });
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('refreshTokenHash');
    });

    it('throws UnauthorizedException when the user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when the user is soft-deleted', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));

      await expect(service.getProfile('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
