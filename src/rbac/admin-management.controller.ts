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
  Patch,
  Post,
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
import { AdminUserDto, InvitedAdminDto } from './dto/rbac-response.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
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
  @ApiResponse({ status: 201, type: InvitedAdminDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  @ApiResponse({ status: 403, description: 'Missing admins.manage permission' })
  invite(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: InviteAdminDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<InvitedAdminDto> {
    return this.service.invite(actor, dto, this.ctx(ip, userAgent));
  }

  @Get(':id')
  @RequirePermission('admins.view')
  @ApiOperation({ summary: 'View an admin account' })
  @ApiResponse({ status: 200, type: AdminUserDto })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  get(@Param('id') id: string): Promise<AdminUserDto> {
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
    @Param('id') id: string,
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
    @Param('id') id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminUserDto> {
    return this.service.disable(actor, id, this.ctx(ip, userAgent));
  }

  @Post(':id/reset-mfa')
  @RequirePermission('admins.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear an admin's MFA enrollment" })
  @ApiResponse({ status: 200, type: AdminSuccessResponseDto })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async resetMfa(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id') id: string,
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
    @Param('id') id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminSuccessResponseDto> {
    await this.service.revokeSessions(actor, id, this.ctx(ip, userAgent));
    return { success: true };
  }
}
