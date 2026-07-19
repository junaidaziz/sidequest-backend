import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminRequestContext } from '../admin-auth/admin-auth.service';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditResult } from '../audit-log/types/audit';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionDto, RoleDto } from './dto/rbac-response.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { PermissionResolverService } from './permission-resolver.service';

/**
 * Role + permission catalog management. Permissions are seed-only (read-only
 * here). System roles (Owner/Super Admin, isSystem) can't have their permission
 * set edited or be deleted — enforced here, not just by convention.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly resolver: PermissionResolverService,
  ) {}

  async listRoles(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      include: { permissions: { include: { permission: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      mfaRequired: role.mfaRequired,
      permissionKeys: role.permissions.map((rp) => rp.permission.key),
    }));
  }

  async listPermissions(): Promise<PermissionDto[]> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return permissions.map((p) => ({
      id: p.id,
      key: p.key,
      description: p.description,
      category: p.category,
    }));
  }

  /** Replaces a non-system role's permission set with the given catalog keys. */
  async updateRolePermissions(
    actor: AuthAdmin,
    roleId: string,
    dto: UpdateRolePermissionsDto,
    ctx: AdminRequestContext,
  ): Promise<RoleDto> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot have their permissions edited');
    }

    // Resolve keys → ids, rejecting any unknown key (permissions are seed-only).
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: dto.permissionKeys } },
    });
    if (permissions.length !== dto.permissionKeys.length) {
      const known = new Set(permissions.map((p) => p.key));
      const unknown = dto.permissionKeys.filter((k) => !known.has(k));
      throw new BadRequestException(`Unknown permission keys: ${unknown.join(', ')}`);
    }

    const previousKeys = role.permissions.map((rp) => rp.permission.key);

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      }),
    ]);

    // Any admin holding this role now has a different effective set — invalidate.
    await this.resolver.bumpRoleVersion();

    await this.audit.record({
      actorAdminUserId: actor.adminUserId,
      action: 'roles.manage',
      targetType: 'Role',
      targetId: roleId,
      previousValue: { permissionKeys: previousKeys },
      newValue: { permissionKeys: dto.permissionKeys },
      result: AuditResult.Success,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      mfaRequired: role.mfaRequired,
      permissionKeys: dto.permissionKeys,
    };
  }
}
