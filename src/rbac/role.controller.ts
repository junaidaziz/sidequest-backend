import { Body, Controller, Get, Headers, Ip, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminRequestContext } from '../admin-auth/admin-auth.service';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from './decorators/require-permission.decorator';
import { PermissionDto, RoleDto } from './dto/rbac-response.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { PermissionGuard } from './guards/permission.guard';
import { RoleService } from './role.service';

/** Role + permission catalog. Permissions are read-only (seed-managed). */
@ApiTags('admin-roles')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin')
export class RoleController {
  constructor(private readonly service: RoleService) {}

  private ctx(ip: string, userAgent?: string): AdminRequestContext {
    return { ipAddress: ip, userAgent: userAgent ?? null };
  }

  @Get('roles')
  @RequirePermission('roles.view')
  @ApiOperation({ summary: 'List roles with their permission sets' })
  @ApiResponse({ status: 200, type: [RoleDto] })
  @ApiResponse({ status: 403, description: 'Missing roles.view permission' })
  listRoles(): Promise<RoleDto[]> {
    return this.service.listRoles();
  }

  @Get('permissions')
  @RequirePermission('roles.view')
  @ApiOperation({ summary: 'List the full permission catalog (read-only)' })
  @ApiResponse({ status: 200, type: [PermissionDto] })
  @ApiResponse({ status: 403, description: 'Missing roles.view permission' })
  listPermissions(): Promise<PermissionDto[]> {
    return this.service.listPermissions();
  }

  @Patch('roles/:id/permissions')
  @RequirePermission('roles.manage')
  @ApiOperation({ summary: "Replace a non-system role's permission set" })
  @ApiResponse({ status: 200, type: RoleDto })
  @ApiResponse({ status: 400, description: 'Unknown permission keys' })
  @ApiResponse({ status: 403, description: 'System role or missing roles.manage permission' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  updateRolePermissions(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<RoleDto> {
    return this.service.updateRolePermissions(actor, id, dto, this.ctx(ip, userAgent));
  }
}
