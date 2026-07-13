import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenType } from './types/jwt-payload.interface';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

// Auto-mocked: OAuth2Client.prototype.verifyIdToken becomes a jest.fn shared by
// every instance the service constructs, so no real network/JWKS call is made.
jest.mock('google-auth-library');

const bcryptHash = bcrypt.hash as jest.Mock;
const bcryptCompare = bcrypt.compare as jest.Mock;
const verifyIdToken = OAuth2Client.prototype.verifyIdToken as jest.Mock;

const CONFIG: Record<string, string> = {
  JWT_SECRET: 'test-secret',
  JWT_ACCESS_TOKEN_TTL: '15m',
  JWT_REFRESH_TOKEN_TTL: '30d',
  GUEST_TOKEN_TTL: '90d',
  GOOGLE_OAUTH_WEB_CLIENT_ID: 'web-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_IOS_CLIENT_ID: 'ios-client-id.apps.googleusercontent.com',
};

/** Points OAuth2Client.verifyIdToken at a fake ticket carrying the given claims. */
function mockGooglePayload(overrides: Record<string, unknown> = {}): void {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      sub: 'google-sub',
      email: 'ada@example.com',
      email_verified: true,
      name: 'Google Name',
      ...overrides,
    }),
  });
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: 'hashed-password',
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
    verifyIdToken.mockReset();
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

  describe('googleAuth', () => {
    it('throws UnauthorizedException and touches no DB row when verification throws', async () => {
      verifyIdToken.mockRejectedValue(new Error('invalid signature'));

      await expect(service.googleAuth({ idToken: 'bad.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a token whose email is not verified, without any DB write', async () => {
      mockGooglePayload({ email_verified: false });

      await expect(service.googleAuth({ idToken: 'unverified.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects when the ticket carries no payload', async () => {
      verifyIdToken.mockResolvedValue({ getPayload: () => undefined });

      await expect(service.googleAuth({ idToken: 'empty.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the payload is missing the sub claim', async () => {
      mockGooglePayload({ sub: undefined });

      await expect(service.googleAuth({ idToken: 'no.sub.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the payload is missing the email claim', async () => {
      mockGooglePayload({ email: undefined });

      await expect(service.googleAuth({ idToken: 'no.email.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('verifies the token against both the web and iOS client IDs', async () => {
      mockGooglePayload();
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ googleId: 'google-sub', isGuest: false }),
      );

      await service.googleAuth({ idToken: 'good.token' });

      expect(verifyIdToken).toHaveBeenCalledWith({
        idToken: 'good.token',
        audience: [
          'web-client-id.apps.googleusercontent.com',
          'ios-client-id.apps.googleusercontent.com',
        ],
      });
    });

    it('logs in a returning Google user, persisting only the rotated token hash', async () => {
      mockGooglePayload();
      const existing = buildUser({ id: 'gu-1', googleId: 'google-sub', isGuest: false });
      prisma.user.findUnique.mockResolvedValueOnce(existing); // googleId lookup hits
      prisma.user.update.mockResolvedValue(existing);

      const result = await service.googleAuth({ idToken: 'good.token' });

      // Only the token-hash persist write — no linking/upgrade update, no create.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'gu-1' },
        data: { refreshTokenHash: expect.any(String) },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'gu-1', email: 'ada@example.com', displayName: 'Ada', isGuest: false },
      });
    });

    it('auto-links Google to an existing password account, preserving displayName and passwordHash', async () => {
      mockGooglePayload({ name: 'Google Name' });
      const passwordAccount = buildUser({
        id: 'pw-1',
        googleId: null,
        passwordHash: 'existing-secret-hash',
        displayName: 'Ada', // user-set; must NOT be overwritten by "Google Name"
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId lookup misses
        .mockResolvedValueOnce(passwordAccount); // email lookup hits
      prisma.user.update.mockResolvedValue(
        buildUser({ id: 'pw-1', googleId: 'google-sub', passwordHash: 'existing-secret-hash' }),
      );

      await service.googleAuth({ idToken: 'good.token' });

      const linkCall = prisma.user.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(linkCall.where).toEqual({ id: 'pw-1' });
      expect(linkCall.data.googleId).toBe('google-sub');
      expect(linkCall.data.isGuest).toBe(false);
      expect(linkCall.data.displayName).toBe('Ada'); // preserved, not "Google Name"
      // passwordHash must be untouched by the link write.
      expect(linkCall.data).not.toHaveProperty('passwordHash');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('backfills displayName from Google when the linked account had none', async () => {
      mockGooglePayload({ name: 'Google Name' });
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildUser({ id: 'pw-2', googleId: null, displayName: null }));
      prisma.user.update.mockResolvedValue(buildUser({ id: 'pw-2', googleId: 'google-sub' }));

      await service.googleAuth({ idToken: 'good.token' });

      const linkCall = prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(linkCall.data.displayName).toBe('Google Name');
    });

    it('upgrades a guest in place via a valid guest bearer token, preserving XP', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId lookup misses
        .mockResolvedValueOnce(null) // email lookup misses
        .mockResolvedValueOnce(
          buildUser({
            id: 'guest-1',
            isGuest: true,
            email: null,
            googleId: null,
            passwordHash: null,
            displayName: null,
            totalXp: 250, // pre-existing progress that must survive the upgrade
            currentStreak: 4,
          }),
        );
      prisma.user.update.mockResolvedValue(buildUser({ id: 'guest-1', isGuest: false }));
      jwtService.verify.mockReturnValue({ sub: 'guest-1', isGuest: true, type: TokenType.Access });

      await service.googleAuth({ idToken: 'good.token' }, 'Bearer guest-access-token');

      // Single folded write (email + googleId + isGuest + fresh hash), no create.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const upgradeCall = prisma.user.update.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(upgradeCall.where).toEqual({ id: 'guest-1' });
      expect(upgradeCall.data.email).toBe('ada@example.com');
      expect(upgradeCall.data.googleId).toBe('google-sub');
      expect(upgradeCall.data.isGuest).toBe(false);
      expect(upgradeCall.data.refreshTokenHash).toEqual(expect.any(String));
      // XP/streak fields are never in the upgrade payload, so they carry over.
      expect(upgradeCall.data).not.toHaveProperty('totalXp');
      expect(upgradeCall.data).not.toHaveProperty('currentStreak');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a brand-new Google account (passwordHash null) when nothing matches', async () => {
      mockGooglePayload({ name: undefined }); // no Google name → displayName null
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId lookup misses
        .mockResolvedValueOnce(null); // email lookup misses
      prisma.user.create.mockResolvedValue(
        buildUser({ id: 'new-1', googleId: 'google-sub', isGuest: false }),
      );

      await service.googleAuth({ idToken: 'good.token' });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          email: 'ada@example.com',
          googleId: 'google-sub',
          displayName: null,
          isGuest: false,
          passwordHash: null,
          refreshTokenHash: expect.any(String),
        }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('falls back to creating an account when a guest bearer token no longer qualifies', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId miss
        .mockResolvedValueOnce(null) // email miss
        .mockResolvedValueOnce(buildUser({ id: 'guest-1', isGuest: false })); // already upgraded
      prisma.user.create.mockResolvedValue(buildUser({ id: 'new-1', googleId: 'google-sub' }));
      jwtService.verify.mockReturnValue({ sub: 'guest-1', isGuest: true, type: TokenType.Access });

      await service.googleAuth({ idToken: 'good.token' }, 'Bearer stale-guest-token');

      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('maps a concurrent-sign-in email unique-constraint race to UnauthorizedException, not 409', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId miss
        .mockResolvedValueOnce(null); // email miss
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        }),
      );

      await expect(service.googleAuth({ idToken: 'good.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('re-throws a non-unique-constraint database error unchanged', async () => {
      mockGooglePayload();
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const dbError = new Error('connection lost');
      prisma.user.create.mockRejectedValue(dbError);

      await expect(service.googleAuth({ idToken: 'good.token' })).rejects.toBe(dbError);
    });

    it('does not authenticate a soft-deleted googleId match, falling through to create a new account', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(
          buildUser({ id: 'gu-deleted', googleId: 'google-sub', deletedAt: new Date() }),
        ) // googleId lookup hits but soft-deleted
        .mockResolvedValueOnce(null); // email lookup misses
      prisma.user.create.mockResolvedValue(
        buildUser({ id: 'new-1', googleId: 'google-sub', isGuest: false }),
      );

      const result = await service.googleAuth({ idToken: 'good.token' });

      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.user.id).toBe('new-1');
    });

    it('does not auto-link a soft-deleted email match, falling through to create a new account', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId lookup misses
        .mockResolvedValueOnce(buildUser({ id: 'pw-deleted', deletedAt: new Date() })); // email lookup hits but soft-deleted
      prisma.user.create.mockResolvedValue(
        buildUser({ id: 'new-1', googleId: 'google-sub', isGuest: false }),
      );

      const result = await service.googleAuth({ idToken: 'good.token' });

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.user.id).toBe('new-1');
    });

    it('maps a concurrent-sign-in googleId unique-constraint race to UnauthorizedException, not a 500', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId miss
        .mockResolvedValueOnce(null); // email miss
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['googleId'] },
        }),
      );

      await expect(service.googleAuth({ idToken: 'good.token' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
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

  describe('logout', () => {
    it('nulls the stored refresh-token hash and returns success', async () => {
      prisma.user.update.mockResolvedValue(buildUser({ refreshTokenHash: null }));

      const result = await service.logout('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null },
      });
      expect(result).toEqual({ success: true });
    });

    it('leaves a subsequent refresh with the old token unable to authenticate', async () => {
      // After logout the row's refreshTokenHash is null; refresh() must reject
      // the still-signed-but-now-orphaned refresh token via the null-hash guard,
      // never reaching the bcrypt.compare against a null hash.
      prisma.user.update.mockResolvedValue(buildUser({ refreshTokenHash: null }));
      await service.logout('user-1');

      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        isGuest: false,
        type: TokenType.Refresh,
      });
      prisma.user.findUnique.mockResolvedValue(buildUser({ refreshTokenHash: null }));

      await expect(
        service.refresh({ refreshToken: 'captured.before.logout' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // The null-hash guard short-circuits before any hash comparison.
      expect(bcryptCompare).not.toHaveBeenCalled();
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
