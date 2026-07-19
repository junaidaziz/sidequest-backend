import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUser, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { AdminLockoutService } from './admin-lockout.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminTokenService } from './admin-token.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import {
  AdminLoginResponseDto,
  AdminProfileDto,
  AdminTokenPairDto,
} from './dto/admin-auth-response.dto';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminMfaChallengeDto } from './dto/admin-mfa-challenge.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminSessionDto } from './dto/admin-session.dto';
import { AuthAdmin } from './types/admin-jwt-payload.interface';

const BCRYPT_ROUNDS = 12;
const GENERIC_AUTH_ERROR = 'Invalid email or password';
/** Same-cost dummy compare on the unknown-account path — closes the enumeration timing leak. */
const DUMMY_BCRYPT_HASH = '$2b$12$NRa8c1JQWgpx8Ftwwgz8VOc967Tx.VK9IeZ02zmPkAFFnoiY0bnMK';

const CHALLENGE_TTL_SECONDS = 300;
const RESET_TTL_SECONDS = 3600;
const INVITE_TTL_SECONDS = 7 * 24 * 3600;

/** Per-request audit context threaded from the controller (IP + user agent). */
export interface AdminRequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

type AdminWithRole = AdminUser & { role: Role };

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly portalUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: AdminTokenService,
    private readonly mfa: AdminMfaService,
    private readonly lockout: AdminLockoutService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.portalUrl = config.get<string>('ADMIN_PORTAL_URL') ?? 'http://localhost:3001';
  }

  /**
   * Email + password login. For an MFA-enabled account, no tokens are issued —
   * a short-lived challenge is returned instead. For an MFA-required-but-unenrolled
   * account, tokens ARE issued but the admin is flagged mfaPending and blocked
   * from permission-gated routes until enrolled.
   */
  async login(dto: AdminLoginDto, ctx: AdminRequestContext): Promise<AdminLoginResponseDto> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
      include: { role: true },
    });

    if (!admin || !admin.passwordHash || admin.deletedAt || admin.status === 'Suspended') {
      // Same-cost dummy compare so a missing/invalid account takes the same time.
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      await this.auditLogin(null, dto.email, AuditResult.Failure, 'invalid_credentials', ctx);
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    if (this.lockout.isLocked(admin.lockedUntil)) {
      await this.auditLogin(admin.id, dto.email, AuditResult.Failure, 'account_locked', ctx);
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const passwordMatches = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!passwordMatches) {
      await this.lockout.recordFailure(admin.id);
      await this.auditLogin(admin.id, dto.email, AuditResult.Failure, 'invalid_credentials', ctx);
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    await this.lockout.recordSuccess(admin.id);

    // MFA already enrolled → require a second factor before issuing tokens.
    if (admin.mfaEnabledAt) {
      const challengeId = randomUUID();
      await this.redis.set(this.challengeKey(challengeId), admin.id, 'EX', CHALLENGE_TTL_SECONDS);
      await this.auditLogin(admin.id, dto.email, AuditResult.Success, 'mfa_challenge_issued', ctx);
      return { status: 'mfa_required', challengeId };
    }

    // No MFA enrolled (either not required, or required-but-pending enrollment).
    const pair = await this.createSession(admin, ctx);
    await this.auditLogin(admin.id, dto.email, AuditResult.Success, null, ctx);
    return { status: 'authenticated', ...pair };
  }

  /** Verifies a TOTP or recovery code against a pending login and issues tokens. */
  async completeMfaChallenge(
    dto: AdminMfaChallengeDto,
    ctx: AdminRequestContext,
  ): Promise<AdminTokenPairDto> {
    const adminUserId = await this.redis.get(this.challengeKey(dto.challengeId));
    if (!adminUserId) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: { role: true },
    });
    if (!admin || admin.deletedAt || admin.status === 'Suspended') {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    const ok = await this.mfa.verifyLoginCode(admin, dto.code);
    if (!ok) {
      await this.audit.record({
        actorAdminUserId: admin.id,
        action: 'admin.auth.mfa.challenge',
        targetType: 'AdminUser',
        targetId: admin.id,
        result: AuditResult.Failure,
        reason: 'invalid_mfa_code',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.redis.del(this.challengeKey(dto.challengeId));
    const pair = await this.createSession(admin, ctx);
    await this.audit.record({
      actorAdminUserId: admin.id,
      action: 'admin.auth.mfa.challenge',
      targetType: 'AdminUser',
      targetId: admin.id,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return pair;
  }

  /** Rotates the token pair for the caller's existing session (keeps session identity). */
  async refresh(dto: AdminRefreshDto, ctx: AdminRequestContext): Promise<AdminTokenPairDto> {
    let payload: { sub: string; sid: string };
    try {
      payload = await this.tokens.verifyRefresh(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sid },
      include: { adminUser: { include: { role: true } } },
    });
    if (
      !session ||
      session.adminUserId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const admin = session.adminUser;
    if (admin.deletedAt || admin.status === 'Suspended') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = await this.tokens.compareRefresh(dto.refreshToken, session.refreshTokenHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const issued = await this.tokens.issue(admin.id, session.id);
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: issued.refreshTokenHash,
        expiresAt: issued.expiresAt,
        lastUsedAt: new Date(),
      },
    });
    await this.audit.record({
      actorAdminUserId: admin.id,
      action: 'admin.auth.refresh',
      targetType: 'AdminSession',
      targetId: session.id,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      admin: this.toProfile(admin, admin.role),
    };
  }

  /** Revokes the caller's current session. */
  async logout(auth: AuthAdmin, ctx: AdminRequestContext): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: auth.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorAdminUserId: auth.adminUserId,
      action: 'admin.auth.logout',
      targetType: 'AdminSession',
      targetId: auth.sessionId,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Revokes every live session for the caller — "log out everywhere". */
  async logoutAll(auth: AuthAdmin, ctx: AdminRequestContext): Promise<void> {
    const result = await this.prisma.adminSession.updateMany({
      where: { adminUserId: auth.adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorAdminUserId: auth.adminUserId,
      action: 'admin.auth.logout_all',
      targetType: 'AdminUser',
      targetId: auth.adminUserId,
      newValue: { revokedSessions: result.count },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Lists the caller's sessions (device/login history), current one flagged. */
  async listSessions(auth: AuthAdmin): Promise<AdminSessionDto[]> {
    const sessions = await this.prisma.adminSession.findMany({
      where: { adminUserId: auth.adminUserId },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      createdAt: s.createdAt,
      current: s.id === auth.sessionId,
    }));
  }

  /** Starts MFA enrollment for the authenticated admin (generates + stores an encrypted secret). */
  async setupMfa(auth: AuthAdmin, ctx: AdminRequestContext) {
    const admin = await this.loadAdmin(auth.adminUserId);
    const result = await this.mfa.setup(admin);
    await this.audit.record({
      actorAdminUserId: admin.id,
      action: 'admin.auth.mfa.setup',
      targetType: 'AdminUser',
      targetId: admin.id,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return result;
  }

  /** Confirms the first TOTP code, enables MFA, and returns one-time recovery codes. */
  async verifyMfa(
    auth: AuthAdmin,
    code: string,
    ctx: AdminRequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const admin = await this.loadAdmin(auth.adminUserId);
    const recoveryCodes = await this.mfa.verifyAndEnable(admin, code);
    await this.audit.record({
      actorAdminUserId: admin.id,
      action: 'admin.auth.mfa.verify',
      targetType: 'AdminUser',
      targetId: admin.id,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { recoveryCodes };
  }

  /** Returns the setup-usable AdminUser row for an authenticated admin (for MFA setup/verify). */
  async loadAdmin(adminUserId: string): Promise<AdminWithRole> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: { role: true },
    });
    if (!admin || admin.deletedAt) {
      throw new UnauthorizedException('Admin account not found');
    }
    return admin;
  }

  toProfile(admin: AdminUser, role: Role): AdminProfileDto {
    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      roleId: admin.roleId,
      roleKey: role.key,
      mustChangePassword: admin.mustChangePassword,
      mfaEnabled: admin.mfaEnabledAt !== null,
      mfaEnrollmentRequired: role.mfaRequired && admin.mfaEnabledAt === null,
    };
  }

  /**
   * Always-200 password-reset request. Generates a token (hash stored in Redis
   * with a TTL — there is no reset-token column on the Phase-3 schema) and emails
   * a reset link. Reveals nothing about whether the account exists.
   */
  async forgotPassword(dto: AdminForgotPasswordDto, ctx: AdminRequestContext): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (admin && !admin.deletedAt && admin.status !== 'Suspended') {
      const raw = randomBytes(32).toString('base64url');
      await this.redis.set(this.resetKey(raw), admin.id, 'EX', RESET_TTL_SECONDS);
      const url = `${this.portalUrl}/admin/reset-password?token=${raw}`;
      await this.email.sendAdminPasswordReset(admin.email, url);
      await this.audit.record({
        actorAdminUserId: admin.id,
        action: 'admin.auth.password.forgot',
        targetType: 'AdminUser',
        targetId: admin.id,
        result: AuditResult.Success,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
  }

  /** Completes a reset: sets a new password and revokes all sessions (force re-login). */
  async resetPassword(dto: AdminResetPasswordDto, ctx: AdminRequestContext): Promise<void> {
    const adminUserId = await this.redis.get(this.resetKey(dto.token));
    if (!adminUserId) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.deletedAt) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.adminSession.updateMany({
        where: { adminUserId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.redis.del(this.resetKey(dto.token));
    await this.audit.record({
      actorAdminUserId: admin.id,
      action: 'admin.auth.password.reset',
      targetType: 'AdminUser',
      targetId: admin.id,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * Issues an invite token for a pending admin (called by the rbac invite flow)
   * and returns the raw token so the caller can email a link. Hash stored in
   * Redis with a TTL (no invite-token column on the Phase-3 schema).
   */
  async issueInviteToken(adminUserId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.redis.set(this.inviteKey(raw), adminUserId, 'EX', INVITE_TTL_SECONDS);
    return raw;
  }

  /** Accepts an invitation by setting a password; activates the account and auto-logs in. */
  async acceptInvitation(
    token: string,
    dto: AcceptInvitationDto,
    ctx: AdminRequestContext,
  ): Promise<AdminTokenPairDto> {
    const adminUserId = await this.redis.get(this.inviteKey(token));
    if (!adminUserId) {
      throw new BadRequestException('Invalid or expired invitation');
    }
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: { role: true },
    });
    if (!admin || admin.deletedAt || admin.status !== 'Invited') {
      throw new BadRequestException('Invalid or expired invitation');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const activated = await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        displayName: dto.displayName ?? admin.displayName,
        status: 'Active',
        mustChangePassword: false,
        inviteAcceptedAt: new Date(),
      },
      include: { role: true },
    });
    await this.redis.del(this.inviteKey(token));

    const pair = await this.createSession(activated, ctx);
    await this.audit.record({
      actorAdminUserId: activated.id,
      action: 'admins.invite.accept',
      targetType: 'AdminUser',
      targetId: activated.id,
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return pair;
  }

  /** Signs a token pair and persists a new AdminSession row for it. */
  private async createSession(
    admin: AdminWithRole,
    ctx: AdminRequestContext,
  ): Promise<AdminTokenPairDto> {
    const issued = await this.tokens.issue(admin.id);
    await this.prisma.adminSession.create({
      data: {
        id: issued.sessionId,
        adminUserId: admin.id,
        refreshTokenHash: issued.refreshTokenHash,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        lastUsedAt: new Date(),
        expiresAt: issued.expiresAt,
      },
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      admin: this.toProfile(admin, admin.role),
    };
  }

  private auditLogin(
    actorAdminUserId: string | null,
    email: string,
    result: AuditResult,
    reason: string | null,
    ctx: AdminRequestContext,
  ): Promise<void> {
    return this.audit.record({
      actorAdminUserId,
      action: 'admin.auth.login',
      targetType: 'AdminUser',
      targetId: actorAdminUserId,
      // Never store the password; the email identifies the attempt.
      newValue: { email },
      result,
      reason,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private challengeKey(id: string): string {
    return `admin:mfa:challenge:${id}`;
  }

  private resetKey(rawToken: string): string {
    return `admin:pwreset:${this.hash(rawToken)}`;
  }

  private inviteKey(rawToken: string): string {
    return `admin:invite:${this.hash(rawToken)}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
