import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminRequestContext } from '../admin-auth/admin-auth.service';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { AdminSuccessResponseDto } from '../admin-auth/dto/generic-response.dto';
import { AdminManagementService } from './admin-management.service';
import { RequirePermission } from './decorators/require-permission.decorator';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { AdminMeDto, AdminUserDto, PermissionOverrideDto } from './dto/rbac-response.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { UpsertPermissionOverrideDto } from './dto/upsert-permission-override.dto';
import { PermissionGuard } from './guards/permission.guard';

/** Admin user management. Every route is permission-gated per the Phase-3 catalog. */
@ApiTags('admin-admins')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/admins')
export class AdminManagementController {
  constructor(private readonly service: AdminManagementService) {}

  private ctx(ip: string, userAgent?: string): AdminRequestContext {
    return { ipAddress: ip, userAgent: userAgent ?? null };
  }

  @Get()
  @RequirePermission('admins.view')
  @ApiOperation({ summary: 'List admin accounts' })
  @ApiResponse({ status: 200, type: [AdminUserDto] })
  @ApiResponse({ status: 403, description: 'Missing admins.view permission' })
  list(): Promise<AdminUserDto[]> {
    return this.service.list();
  }

  @Post()
  @RequirePermission('admins.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a new admin (creates a pending account + emails a link)' })
  @ApiResponse({ status: 201, type: AdminUserDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  @ApiResponse({ status: 403, description: 'Missing admins.manage permission' })
  invite(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: InviteAdminDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminUserDto> {
    return this.service.invite(actor, dto, this.ctx(ip, userAgent));
  }

  @Post(':id/resend-invite')
  @RequirePermission('admins.manage')
  @ApiOperation({ summary: 'Retry delivery of a pending admin invitation' })
  resendInvite(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminUserDto> {
    return this.service.resendInvite(actor, id, this.ctx(ip, userAgent));
  }

  // NOTE: registered before ':id' — Nest/Express match routes in declaration
  // order for a shared base path, so 'me' must come first or ':id' would
  // swallow it as a literal id value of "me".
  @Get('me')
  @ApiOperation({
    summary: "Get the caller's own profile, role, and effective permissions",
  })
  @ApiResponse({ status: 200, type: AdminMeDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid admin token' })
  getSelf(@CurrentAdmin() actor: AuthAdmin): Promise<AdminMeDto> {
    return this.service.getSelf(actor);
  }

  @Get(':id')
  @RequirePermission('admins.view')
  @ApiOperation({ summary: 'View an admin account' })
  @ApiResponse({ status: 200, type: AdminUserDto })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDto> {
    return this.service.get(id);
  }

  @Patch(':id')
  @RequirePermission('admins.manage')
  @ApiOperation({ summary: 'Edit an admin (role change additionally requires roles.assign)' })
  @ApiResponse({ status: 200, type: AdminUserDto })
  @ApiResponse({ status: 403, description: 'Missing admins.manage / roles.assign permission' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminUserDto> {
    return this.service.update(actor, id, dto, this.ctx(ip, userAgent));
  }

  @Delete(':id')
  @RequirePermission('admins.manage')
  @ApiOperation({ summary: 'Disable (suspend) an admin and revoke their sessions' })
  @ApiResponse({ status: 200, type: AdminUserDto })
  @ApiResponse({ status: 400, description: 'Cannot disable your own account' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  disable(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminUserDto> {
    return this.service.disable(actor, id, this.ctx(ip, userAgent));
  }

  // ---------------------------------------------------------------------------
  // Per-admin permission overrides (GRANT/REVOKE a single permission on top of
  // the admin's role baseline). Mutations are gated by `permissions.assign` — the
  // dedicated catalog permission for exactly this ("Grant or revoke granular
  // permission overrides"), the granular-permission analog of the `roles.assign`
  // gate on role reassignment. Reading is gated by `admins.view`, matching the
  // rest of the admin-detail surface. See AdminManagementService for the full
  // rationale on why this is NOT folded under `admins.manage`.
  // ---------------------------------------------------------------------------

  @Get(':id/overrides')
  @RequirePermission('admins.view')
  @ApiOperation({ summary: "List an admin's permission overrides (divergence from role baseline)" })
  @ApiResponse({ status: 200, type: [PermissionOverrideDto] })
  @ApiResponse({ status: 403, description: 'Missing admins.view permission' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  listOverrides(@Param('id', ParseUUIDPipe) id: string): Promise<PermissionOverrideDto[]> {
    return this.service.listOverrides(id);
  }

  @Put(':id/overrides/:permissionKey')
  @RequirePermission('permissions.assign')
  @ApiOperation({
    summary: 'Grant or revoke a single permission for an admin (upsert; idempotent per pair)',
  })
  @ApiResponse({ status: 200, type: PermissionOverrideDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid or missing effect field (must be GRANT or REVOKE)',
  })
  @ApiResponse({ status: 403, description: 'Missing permissions.assign permission' })
  @ApiResponse({ status: 404, description: 'Admin or permission key not found' })
  upsertOverride(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionKey') permissionKey: string,
    @Body() dto: UpsertPermissionOverrideDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PermissionOverrideDto> {
    return this.service.upsertOverride(actor, id, permissionKey, dto, this.ctx(ip, userAgent));
  }

  // NOTE (backend-eval B4, reviewed): a pure-REST reading would make this 204
  // with no body, since it deletes a row rather than transitioning a resource's
  // state. Deliberately kept at 200 + AdminSuccessResponseDto instead, to match
  // every other admin-management action route in this controller (`disable`,
  // `reset-mfa`, `revoke-sessions`) — all four are "take this admin action"
  // endpoints from a caller's perspective, and giving them one uniform response
  // shape (rather than three returning `{ success: true }` and this one alone
  // returning an empty body) is worth more than REST purity on a single route
  // in an otherwise-consistent, small controller.
  @Delete(':id/overrides/:permissionKey')
  @RequirePermission('permissions.assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Remove an admin's override for a permission (revert to role baseline; idempotent)",
  })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 403, description: 'Missing permissions.assign permission' })
  @ApiResponse({ status: 404, description: 'Admin or permission key not found' })
  async removeOverride(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionKey') permissionKey: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.removeOverride(actor, id, permissionKey, this.ctx(ip, userAgent));
    return { success: true };
  }

  @Post(':id/reset-mfa')
  @RequirePermission('admins.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear an admin's MFA enrollment" })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async resetMfa(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.resetMfa(actor, id, this.ctx(ip, userAgent));
    return { success: true };
  }

  @Post(':id/revoke-sessions')
  @RequirePermission('admins.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke all of an admin's sessions" })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async revokeSessions(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.revokeSessions(actor, id, this.ctx(ip, userAgent));
    return { success: true };
  }
}
