import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminUser, Prisma, Role } from '@prisma/client';
import { AdminAuthService, AdminRequestContext } from '../admin-auth/admin-auth.service';
import { AdminMfaService } from '../admin-auth/admin-mfa.service';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUserDto, InvitedAdminDto } from './dto/rbac-response.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
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

  /** Creates a pending admin, generates an invite token, and emails an accept link. */
  async invite(
    actor: AuthAdmin,
    dto: InviteAdminDto,
    ctx: AdminRequestContext,
  ): Promise<InvitedAdminDto> {
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

    // Returning the raw token is a dev-only convenience while email is a no-op —
    // see InvitedAdminDto. Remove once a real email provider is wired.
    return { ...this.toDto(created, created.role), inviteToken };
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
      lockedUntil: admin.lockedUntil,
      createdAt: admin.createdAt,
    };
  }
}
