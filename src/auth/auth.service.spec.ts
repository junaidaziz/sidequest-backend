import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ReferralsService } from '../referrals/referrals.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    suspendedAt: null,
    suspensionReason: null,
    suspendedByAdminId: null,
    restrictedFeatures: [],
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
    completion: { findMany: jest.Mock; updateMany: jest.Mock };
    userTaskAttachment: { findMany: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
    verify: jest.Mock;
    verifyAsync: jest.Mock;
  };
  let storage: { getSignedDownloadUrl: jest.Mock; deleteObject: jest.Mock };
  let referrals: { resolveReferrer: jest.Mock; attributeSignup: jest.Mock };
  let notifications: { deregisterPushToken: jest.Mock; deregisterAllPushTokens: jest.Mock };

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
      completion: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userTaskAttachment: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Interactive transaction: invoke the callback with the same prisma mock as
      // the transactional client so per-model mocks above are reused inside it.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      verify: jest.fn(),
      verifyAsync: jest.fn(),
    };
    storage = {
      getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/avatar'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    referrals = {
      resolveReferrer: jest.fn().mockResolvedValue('referrer-1'),
      attributeSignup: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      deregisterPushToken: jest.fn().mockResolvedValue({ success: true, removed: 1 }),
      deregisterAllPushTokens: jest.fn().mockResolvedValue({ success: true, removed: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: StorageService, useValue: storage },
        { provide: ReferralsService, useValue: referrals },
        { provide: NotificationsService, useValue: notifications },
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
        user: { id: 'user-1', email: null, displayName: 'Ada', isGuest: true, avatarUrl: null },
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

    describe('referral attribution (M20.3)', () => {
      it('validates the code before writing and attributes the new account', async () => {
        prisma.user.findUnique.mockResolvedValueOnce(null);
        prisma.user.create.mockResolvedValue(buildUser({ id: 'referee-1' }));
        referrals.resolveReferrer.mockResolvedValue('referrer-1');

        await service.signup({
          email: 'ada@example.com',
          password: 'password123',
          referralCode: 'H7KMNP34',
        });

        expect(referrals.resolveReferrer).toHaveBeenCalledWith('H7KMNP34', undefined);
        expect(referrals.attributeSignup).toHaveBeenCalledWith({
          refereeId: 'referee-1',
          referrerId: 'referrer-1',
          code: 'H7KMNP34',
        });
      });

      it('surfaces an invalid code as the thrown error without creating an account', async () => {
        prisma.user.findUnique.mockResolvedValueOnce(null);
        referrals.resolveReferrer.mockRejectedValue(new Error('Invalid referral code'));

        await expect(
          service.signup({
            email: 'ada@example.com',
            password: 'password123',
            referralCode: 'BADCODE1',
          }),
        ).rejects.toThrow('Invalid referral code');
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(referrals.attributeSignup).not.toHaveBeenCalled();
      });

      it('does not attribute anything when no referral code is supplied', async () => {
        prisma.user.findUnique.mockResolvedValueOnce(null);
        prisma.user.create.mockResolvedValue(buildUser());

        await service.signup({ email: 'ada@example.com', password: 'password123' });

        expect(referrals.resolveReferrer).not.toHaveBeenCalled();
        expect(referrals.attributeSignup).not.toHaveBeenCalled();
      });

      it('passes the upgrading guest id as the self-referral candidate', async () => {
        prisma.user.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(buildUser({ id: 'guest-1', isGuest: true, email: null }));
        prisma.user.update.mockResolvedValue(buildUser({ id: 'guest-1', isGuest: false }));
        jwtService.verify.mockReturnValue({
          sub: 'guest-1',
          isGuest: true,
          type: TokenType.Access,
        });

        await service.signup(
          { email: 'ada@example.com', password: 'password123', referralCode: 'H7KMNP34' },
          'Bearer guest-token',
        );

        expect(referrals.resolveReferrer).toHaveBeenCalledWith('H7KMNP34', 'guest-1');
        expect(referrals.attributeSignup).toHaveBeenCalledWith({
          refereeId: 'guest-1',
          referrerId: 'referrer-1',
          code: 'H7KMNP34',
        });
      });

      it('does not fail signup when attribution fails after the account is already committed', async () => {
        // Regression test: attributeSignup used to be called with no isolation
        // of its own, so a non-P2002 failure (e.g. a transient DB error) would
        // propagate into signup()'s outer catch and be rethrown as a 500 —
        // even though the account row was already written. The caller should
        // get their 201 with a working account; the unattributed referral is
        // logged, not fatal.
        prisma.user.findUnique.mockResolvedValueOnce(null);
        prisma.user.create.mockResolvedValue(buildUser({ id: 'referee-1' }));
        referrals.resolveReferrer.mockResolvedValue('referrer-1');
        referrals.attributeSignup.mockRejectedValueOnce(new Error('connection reset'));

        const result = await service.signup({
          email: 'ada@example.com',
          password: 'password123',
          referralCode: 'H7KMNP34',
        });

        expect(result.user.id).toBe('referee-1');
        expect(referrals.attributeSignup).toHaveBeenCalledTimes(1);
      });
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
        user: {
          id: 'gu-1',
          email: 'ada@example.com',
          displayName: 'Ada',
          isGuest: false,
          avatarUrl: null,
        },
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

    it('attributes a referral when a brand-new Google account is created', async () => {
      mockGooglePayload();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId miss
        .mockResolvedValueOnce(null); // email miss
      prisma.user.create.mockResolvedValue(buildUser({ id: 'referee-g', isGuest: false }));
      referrals.resolveReferrer.mockResolvedValue('referrer-1');

      await service.googleAuth({ idToken: 'good.token', referralCode: 'H7KMNP34' });

      expect(referrals.attributeSignup).toHaveBeenCalledWith({
        refereeId: 'referee-g',
        referrerId: 'referrer-1',
        code: 'H7KMNP34',
      });
    });

    it('validates but does NOT attribute a referral for a returning Google user', async () => {
      mockGooglePayload();
      const existing = buildUser({ id: 'gu-1', googleId: 'google-sub', isGuest: false });
      prisma.user.findUnique.mockResolvedValueOnce(existing);
      prisma.user.update.mockResolvedValue(existing);
      referrals.resolveReferrer.mockResolvedValue('referrer-1');

      await service.googleAuth({ idToken: 'good.token', referralCode: 'H7KMNP34' });

      // The code is still validated up front (invalid → 400)...
      expect(referrals.resolveReferrer).toHaveBeenCalledWith('H7KMNP34', undefined);
      // ...but a returning user already registered, so nothing is attributed.
      expect(referrals.attributeSignup).not.toHaveBeenCalled();
    });

    it('rejects a Google sign-in with an invalid referral code before any DB write', async () => {
      mockGooglePayload();
      referrals.resolveReferrer.mockRejectedValue(new Error('Invalid referral code'));

      await expect(
        service.googleAuth({ idToken: 'good.token', referralCode: 'BADCODE1' }),
      ).rejects.toThrow('Invalid referral code');
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(referrals.attributeSignup).not.toHaveBeenCalled();
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
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada',
          isGuest: false,
          avatarUrl: null,
        },
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
        user: {
          id: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada',
          isGuest: false,
          avatarUrl: null,
        },
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
      // No push token supplied => no deregistration attempted.
      expect(notifications.deregisterPushToken).not.toHaveBeenCalled();
    });

    it('deregisters the device push token when one is supplied (M21.3)', async () => {
      prisma.user.update.mockResolvedValue(buildUser({ refreshTokenHash: null }));

      const result = await service.logout('user-1', 'ExponentPushToken[abc]');

      expect(notifications.deregisterPushToken).toHaveBeenCalledWith(
        'user-1',
        'ExponentPushToken[abc]',
      );
      expect(result).toEqual({ success: true });
    });

    it('still logs out when push-token deregistration fails (isolation)', async () => {
      prisma.user.update.mockResolvedValue(buildUser({ refreshTokenHash: null }));
      notifications.deregisterPushToken.mockRejectedValue(new Error('db down'));

      const result = await service.logout('user-1', 'ExponentPushToken[abc]');

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
        avatarUrl: null,
      });
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('refreshTokenHash');
    });

    it('resolves avatarUrl to a presigned URL when the user has an avatar key', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ avatarUrl: 'avatars/user-1/pic.png' }));

      const profile = await service.getProfile('user-1');

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('avatars/user-1/pic.png');
      expect(profile.avatarUrl).toBe('https://signed.example/avatar');
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

  describe('updateDisplayName', () => {
    it('updates the display name and returns the refreshed profile', async () => {
      prisma.user.update.mockResolvedValue(buildUser({ displayName: 'New Name' }));

      const profile = await service.updateDisplayName('user-1', 'New Name');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { displayName: 'New Name' },
      });
      expect(profile).toEqual({
        id: 'user-1',
        email: 'ada@example.com',
        displayName: 'New Name',
        isGuest: false,
        avatarUrl: null,
      });
    });

    it('resolves avatarUrl in the returned profile when the row has an avatar key', async () => {
      prisma.user.update.mockResolvedValue(
        buildUser({ displayName: 'New Name', avatarUrl: 'avatars/user-1/pic.png' }),
      );

      const profile = await service.updateDisplayName('user-1', 'New Name');

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('avatars/user-1/pic.png');
      expect(profile.avatarUrl).toBe('https://signed.example/avatar');
    });
  });

  describe('changePassword (M22.1)', () => {
    it('rejects a no-password (guest/Google-only) account with a distinct 400', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash: null }));

      await expect(
        service.changePassword('user-1', { currentPassword: 'x', newPassword: 'new-password' }),
      ).rejects.toThrow(BadRequestException);
      // Not a confusing UnauthorizedException — never even calls bcrypt.compare.
      expect(bcryptCompare).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password with 401', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'new-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password identical to the current one with 400', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(true);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'same-password',
          newPassword: 'same-password',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('hashes and stores the new password on a valid change', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(true);
      bcryptHash.mockResolvedValue('new-bcrypt-hash');

      const result = await service.changePassword('user-1', {
        currentPassword: 'current-password',
        newPassword: 'new-password',
      });

      expect(bcryptHash).toHaveBeenCalledWith('new-password', 12);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-bcrypt-hash', refreshTokenHash: null },
      });
      expect(result).toEqual({ success: true });
    });

    it('rejects a missing/soft-deleted user with 401 (defensive)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('ghost', { currentPassword: 'x', newPassword: 'new-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('deleteAccount (M22.2)', () => {
    it('requires currentPassword for a password account (400)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(service.deleteAccount('user-1', {})).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password for a password account (401)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(false);

      await expect(service.deleteAccount('user-1', { currentPassword: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('requires confirm=true for a no-password (Google/guest) account (400)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash: null }));

      await expect(service.deleteAccount('user-1', {})).rejects.toThrow(BadRequestException);
      // Never attempts a bcrypt compare — there is no password to verify.
      expect(bcryptCompare).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not let a password account bypass the password check by sending confirm=true alone', async () => {
      // Regression test named per independent review: `confirm` and
      // `currentPassword` are not an either/or on a password account — only
      // proving the password is accepted. Sending confirm=true with no
      // currentPassword must still 400, never skip straight to deletion.
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(service.deleteAccount('user-1', { confirm: true })).rejects.toThrow(
        BadRequestException,
      );
      expect(bcryptCompare).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('soft-deletes and anonymizes on a correct password', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(true);

      const result = await service.deleteAccount('user-1', { currentPassword: 'current-password' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          deletedAt: expect.any(Date),
          refreshTokenHash: null,
          displayName: 'Deleted User',
          avatarUrl: null,
        },
      });
      expect(result).toEqual({ success: true });
    });

    it('soft-deletes a no-password account when confirm=true', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash: null }));

      const result = await service.deleteAccount('user-1', { confirm: true });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            displayName: 'Deleted User',
            deletedAt: expect.any(Date),
          }),
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('de-references owned media pointers and best-effort deletes the S3 objects', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ avatarUrl: 'avatars/user-1/pic.png' }));
      bcryptCompare.mockResolvedValue(true);
      prisma.completion.findMany.mockResolvedValue([
        { proofKey: 'proofs/a.jpg' },
        { proofKey: 'proofs/b.jpg' },
      ]);
      prisma.userTaskAttachment.findMany.mockResolvedValue([
        { id: 'att-1', objectKey: 'att/1.jpg' },
      ]);

      await service.deleteAccount('user-1', { currentPassword: 'current-password' });

      // DB pointers nulled inside the transaction, scoped to the deleting user.
      expect(prisma.completion.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', proofKey: { not: null } },
        data: { proofKey: null },
      });
      expect(prisma.userTaskAttachment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['att-1'] } },
        data: { objectKey: null },
      });
      // Best-effort S3 delete of avatar + every proof + every attachment key.
      expect(storage.deleteObject).toHaveBeenCalledWith('avatars/user-1/pic.png');
      expect(storage.deleteObject).toHaveBeenCalledWith('proofs/a.jpg');
      expect(storage.deleteObject).toHaveBeenCalledWith('proofs/b.jpg');
      expect(storage.deleteObject).toHaveBeenCalledWith('att/1.jpg');
    });

    it("deregisters all of the user's push tokens", async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(true);

      await service.deleteAccount('user-1', { currentPassword: 'current-password' });

      expect(notifications.deregisterAllPushTokens).toHaveBeenCalledWith('user-1');
    });

    it('still succeeds if push-token deregistration fails (isolated side effect)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      bcryptCompare.mockResolvedValue(true);
      notifications.deregisterAllPushTokens.mockRejectedValue(new Error('redis down'));

      await expect(
        service.deleteAccount('user-1', { currentPassword: 'current-password' }),
      ).resolves.toEqual({ success: true });
    });

    it('still succeeds if an S3 object delete fails (best-effort cleanup)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ avatarUrl: 'avatars/user-1/pic.png' }));
      bcryptCompare.mockResolvedValue(true);
      storage.deleteObject.mockRejectedValue(new Error('s3 unavailable'));

      await expect(
        service.deleteAccount('user-1', { currentPassword: 'current-password' }),
      ).resolves.toEqual({ success: true });
    });

    it('rejects a missing/soft-deleted user with 401 (defensive)', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ deletedAt: new Date() }));

      await expect(service.deleteAccount('user-1', { currentPassword: 'x' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
