import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUser, AdminUserPermissionOverride, Permission, Prisma, Role } from '@prisma/client';
import { AdminAuthService, AdminRequestContext } from '../admin-auth/admin-auth.service';
import { AdminMfaService } from '../admin-auth/admin-mfa.service';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminMeDto, AdminUserDto, PermissionOverrideDto } from './dto/rbac-response.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { UpsertPermissionOverrideDto } from './dto/upsert-permission-override.dto';
import { PermissionResolverService } from './permission-resolver.service';

/**
 * Admin user management (invite / view / edit / disable / reset-mfa /
 * revoke-sessions). Every mutation writes an audit entry. Role reassignment is
 * additionally gated on the caller holding `roles.assign`, on top of the
 * endpoint-level `admins.manage` — roles.assign is a distinct catalog permission.
 */
@Injectable()
export class AdminManagementService {
  private readonly logger = new Logger(AdminManagementService.name);
  private readonly portalUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly email: EmailService,
    private readonly adminAuth: AdminAuthService,
    private readonly mfa: AdminMfaService,
    private readonly resolver: PermissionResolverService,
    config: ConfigService,
  ) {
    this.portalUrl = config.get<string>('ADMIN_PORTAL_URL') ?? 'http://localhost:3001';
  }

  async list(): Promise<AdminUserDto[]> {
    const admins = await this.prisma.adminUser.findMany({
      where: { deletedAt: null },
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    });
    return admins.map((a) => this.toDto(a, a.role));
  }

  async get(id: string): Promise<AdminUserDto> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    return this.toDto(admin, admin.role);
  }

  /**
   * The caller's own profile + effective permission set. Self-service (acts
   * only on the caller's own account), so this is intentionally reachable
   * even without `admins.view` — the web admin portal's BFF calls this once
   * on session load to render the shell's role-gated nav, and every admin
   * (regardless of role) must be able to learn their own permissions.
   */
  async getSelf(auth: AuthAdmin): Promise<AdminMeDto> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: auth.adminUserId, deletedAt: null },
      include: { role: true },
    });
    if (!admin) {
      throw new UnauthorizedException('Admin account not found');
    }
    const permissions = await this.resolver.getEffectivePermissions(admin.id);
    return {
      ...this.toDto(admin, admin.role),
      permissions: [...permissions].sort(),
      mfaEnrollmentRequired: admin.role.mfaRequired && admin.mfaEnabledAt === null,
    };
  }

  /** Creates a pending admin, generates an invite token, and emails an accept link. */
  async invite(
    actor: AuthAdmin,
    dto: InviteAdminDto,
    ctx: AdminRequestContext,
  ): Promise<AdminUserDto> {
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) {
      throw new BadRequestException('Role not found');
    }

    let created: AdminUser & { role: Role };
    try {
      created = await this.prisma.adminUser.create({
        data: {
          email: dto.email,
          displayName: dto.displayName,
          roleId: dto.roleId,
          status: 'Invited',
          mustChangePassword: true,
          invitedByAdminId: actor.adminUserId,
          invitedAt: new Date(),
        },
        include: { role: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An admin with that email already exists');
      }
      throw error;
    }

    // The raw invite token is delivered ONLY via the emailed accept link — it is
    // never returned in the API response. Returning it would let any admin with
    // admins.manage claim someone else's invited account before the real invitee
    // sees the email, defeating the "controls the mailbox" guarantee of invite-
    // by-email. (Until a real email provider is wired the invite email is a
    // console no-op; end-to-end acceptance is an accepted, documented gap.)
    const inviteToken = await this.adminAuth.issueInviteToken(created.id);
    const acceptUrl = `${this.portalUrl}/admin/accept-invite?token=${inviteToken}`;
    await this.email.sendAdminInvite(created.email, actor.email, acceptUrl);

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'admins.manage',
      targetType: 'AdminUser',
      targetId: created.id,
      newValue: { email: created.email, roleId: created.roleId, action: 'invite' },
      result: AuditResult.Success,
      reason: dto.note ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toDto(created, created.role);
  }

  /** Edits display name and/or role. Role change requires the caller's roles.assign. */
  async update(
    actor: AuthAdmin,
    id: string,
    dto: UpdateAdminDto,
    ctx: AdminRequestContext,
  ): Promise<AdminUserDto> {
    const existing = await this.prisma.adminUser.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!existing) {
      throw new NotFoundException('Admin not found');
    }

    const roleChanging = dto.roleId !== undefined && dto.roleId !== existing.roleId;
    if (roleChanging) {
      const canAssign = await this.resolver.hasAll(actor.adminUserId, ['roles.assign']);
      if (!canAssign) {
        throw new ForbiddenException('roles.assign is required to change an admin’s role');
      }
      const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
      if (!role) {
        throw new BadRequestException('Role not found');
      }
    }

    const updated = await this.prisma.adminUser.update({
      where: { id },
      data: {
        displayName: dto.displayName ?? undefined,
        roleId: roleChanging ? dto.roleId : undefined,
      },
      include: { role: true },
    });

    // A role change alters this admin's effective permission set — invalidate cache.
    if (roleChanging) {
      await this.resolver.bumpRoleVersion();
    }

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: roleChanging ? 'roles.assign' : 'admins.manage',
      targetType: 'AdminUser',
      targetId: id,
      previousValue: { displayName: existing.displayName, roleId: existing.roleId },
      newValue: { displayName: updated.displayName, roleId: updated.roleId },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toDto(updated, updated.role);
  }

  /** Disables (suspends) an admin and revokes all their sessions. Cannot target self. */
  async disable(actor: AuthAdmin, id: string, ctx: AdminRequestContext): Promise<AdminUserDto> {
    if (id === actor.adminUserId) {
      throw new BadRequestException('You cannot disable your own account');
    }
    const existing = await this.prisma.adminUser.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
    if (!existing) {
      throw new NotFoundException('Admin not found');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id },
        data: { status: 'Suspended' },
        include: { role: true },
      }),
      this.prisma.adminSession.updateMany({
        where: { adminUserId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'admins.manage',
      targetType: 'AdminUser',
      targetId: id,
      previousValue: { status: existing.status },
      newValue: { status: 'Suspended', action: 'disable' },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return this.toDto(updated, updated.role);
  }

  /** Clears an admin's MFA enrollment (they must re-enroll on next privileged access). */
  async resetMfa(actor: AuthAdmin, id: string, ctx: AdminRequestContext): Promise<void> {
    const existing = await this.prisma.adminUser.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Admin not found');
    }
    await this.mfa.reset(id);
    // Force re-auth too, so a live session can't skip the new enrollment.
    await this.prisma.adminSession.updateMany({
      where: { adminUserId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'admins.manage',
      targetType: 'AdminUser',
      targetId: id,
      newValue: { action: 'reset_mfa' },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Revokes all of an admin's sessions (forced logout everywhere for that admin). */
  async revokeSessions(actor: AuthAdmin, id: string, ctx: AdminRequestContext): Promise<void> {
    const existing = await this.prisma.adminUser.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Admin not found');
    }
    const result = await this.prisma.adminSession.updateMany({
      where: { adminUserId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'admins.manage',
      targetType: 'AdminUser',
      targetId: id,
      newValue: { action: 'revoke_sessions', revokedSessions: result.count },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ---------------------------------------------------------------------------
  // Per-admin permission overrides.
  //
  // These layer a single GRANT/REVOKE on top of an admin's role baseline. They
  // are gated at the controller by `permissions.assign` — the purpose-built
  // catalog permission ("Grant or revoke granular permission overrides"), NOT by
  // `admins.manage`. `permissions.assign` is the granular-permission analog of
  // the `roles.assign` gate that already guards role reassignment on `update()`;
  // both are distinct Administration-category permissions held only by
  // Owner/Super Admin in the seed, so an admin who can invite/edit accounts
  // (`admins.manage`) still cannot silently escalate a peer's individual
  // permissions unless they also hold `permissions.assign`. Reading overrides is
  // gated by `admins.view`, matching `GET /admin/admins/:id`.
  // ---------------------------------------------------------------------------

  /** Lists an admin's current permission overrides (their divergence from the role baseline). */
  async listOverrides(adminId: string): Promise<PermissionOverrideDto[]> {
    // Mirror the exact existence check the other admin-management mutations use:
    // present and not soft-deleted. (Suspended admins are still addressable, as
    // with update/disable — a suspension shouldn't strand their override config.)
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: adminId, deletedAt: null },
      select: { id: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const overrides = await this.prisma.adminUserPermissionOverride.findMany({
      where: { adminUserId: adminId },
      include: { permission: true },
      orderBy: { createdAt: 'asc' },
    });
    return overrides.map((o) => this.toOverrideDto(o, o.permission));
  }

  /**
   * Upserts a single GRANT/REVOKE override for one admin+permission. The unique
   * constraint on `[adminUserId, permissionId]` makes a repeat call for the same
   * pair update the existing effect/reason rather than duplicate or error. Bumps
   * the global role-version afterward so the change is reflected in the admin's
   * effective permission set immediately (no stale-cache window).
   */
  async upsertOverride(
    actor: AuthAdmin,
    adminId: string,
    permissionKey: string,
    dto: UpsertPermissionOverrideDto,
    ctx: AdminRequestContext,
  ): Promise<PermissionOverrideDto> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: adminId, deletedAt: null },
      select: { id: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const permission = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (!permission) {
      throw new NotFoundException(`Unknown permission key: ${permissionKey}`);
    }

    const existing = await this.prisma.adminUserPermissionOverride.findUnique({
      where: { adminUserId_permissionId: { adminUserId: adminId, permissionId: permission.id } },
    });

    const override = await this.prisma.adminUserPermissionOverride.upsert({
      where: { adminUserId_permissionId: { adminUserId: adminId, permissionId: permission.id } },
      create: {
        adminUserId: adminId,
        permissionId: permission.id,
        effect: dto.effect,
        reason: dto.reason ?? null,
        grantedByAdminId: actor.adminUserId,
      },
      update: {
        effect: dto.effect,
        reason: dto.reason ?? null,
        grantedByAdminId: actor.adminUserId,
      },
    });

    // The override changes this admin's effective permission set — invalidate the
    // Redis-cached set exactly as role/permission edits do (role.service mirror).
    await this.resolver.bumpRoleVersion();

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'permissions.assign',
      targetType: 'AdminUser',
      targetId: adminId,
      previousValue: existing
        ? { permissionKey, effect: existing.effect, reason: existing.reason }
        : null,
      newValue: {
        permissionKey,
        effect: override.effect,
        reason: override.reason,
        action: 'upsert',
      },
      result: AuditResult.Success,
      reason: dto.reason ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.toOverrideDto(override, permission);
  }

  /**
   * Removes an admin's override for a permission, reverting them to the role's
   * baseline for that permission (deleting the row is distinct from writing a
   * REVOKE, which actively subtracts). Idempotent — a no-op if no override
   * exists — but still 404s on an unknown permission key so a typo isn't
   * silently swallowed. Only bumps the role-version / audits when a row was
   * actually removed, so a redundant delete produces no cache churn or log noise.
   */
  async removeOverride(
    actor: AuthAdmin,
    adminId: string,
    permissionKey: string,
    ctx: AdminRequestContext,
  ): Promise<{ removed: boolean }> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: adminId, deletedAt: null },
      select: { id: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    const permission = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (!permission) {
      throw new NotFoundException(`Unknown permission key: ${permissionKey}`);
    }

    const existing = await this.prisma.adminUserPermissionOverride.findUnique({
      where: { adminUserId_permissionId: { adminUserId: adminId, permissionId: permission.id } },
    });
    if (!existing) {
      return { removed: false };
    }

    await this.prisma.adminUserPermissionOverride.delete({ where: { id: existing.id } });
    await this.resolver.bumpRoleVersion();

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'permissions.assign',
      targetType: 'AdminUser',
      targetId: adminId,
      previousValue: { permissionKey, effect: existing.effect, reason: existing.reason },
      newValue: { permissionKey, action: 'remove' },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { removed: true };
  }

  private toOverrideDto(
    override: AdminUserPermissionOverride,
    permission: Permission,
  ): PermissionOverrideDto {
    return {
      id: override.id,
      adminUserId: override.adminUserId,
      permissionKey: permission.key,
      effect: override.effect,
      reason: override.reason,
      grantedByAdminId: override.grantedByAdminId,
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    };
  }

  private toDto(admin: AdminUser, role: Role): AdminUserDto {
    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      status: admin.status,
      roleId: admin.roleId,
      roleKey: role.key,
      mfaEnabled: admin.mfaEnabledAt !== null,
      mustChangePassword: admin.mustChangePassword,
      lastLoginAt: admin.lastLoginAt,
      // Expose only a boolean — never the exact lockout-expiry timestamp, so a
      // locked-out attacker can't read when their next attempt window opens.
      isLocked: admin.lockedUntil !== null && admin.lockedUntil.getTime() > Date.now(),
      createdAt: admin.createdAt,
    };
  }
}
