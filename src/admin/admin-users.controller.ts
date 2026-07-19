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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { AdminUserActionContext, AdminUsersService } from './admin-users.service';
import {
  AdminActionResponseDto,
  AdminUserDetailDto,
  AdminUserExportDto,
  AdminUserPageDto,
  ResetVerificationResponseDto,
} from './dto/admin-user-response.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ResetVerificationDto } from './dto/reset-verification.dto';
import { RestrictUserDto } from './dto/restrict-user.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

/**
 * Admin-facing management of mobile-app end users (the `User` table). Gated by the
 * new RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`), NOT the legacy
 * shared-key `AdminGuard`. Thin: routing, guards, DTO binding, and Swagger only —
 * every rule lives in AdminUsersService.
 */
@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @RequirePermission('users.view')
  @ApiOperation({ summary: 'Search / filter / paginate end-user accounts' })
  @ApiResponse({ status: 200, type: AdminUserPageDto })
  @ApiResponse({ status: 403, description: 'Missing users.view permission' })
  list(@Query() query: ListUsersQueryDto): Promise<AdminUserPageDto> {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermission('users.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'View a full end-user profile with proof/challenge/moderation history' })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  getDetail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetailDto> {
    return this.service.getDetail(id);
  }

  @Patch(':id/suspend')
  @RequirePermission('users.suspend')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Suspend an account (requires a reason; enforced immediately)' })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Already suspended, or account is deleted' })
  suspend(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminUserDetailDto> {
    return this.service.suspend(id, dto, this.ctx(actor, ip, ua));
  }

  @Patch(':id/reactivate')
  @RequirePermission('users.suspend')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Lift a suspension' })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Account is not suspended' })
  reactivate(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminUserDetailDto> {
    return this.service.reactivate(id, this.ctx(actor, ip, ua));
  }

  @Patch(':id/restrict')
  @RequirePermission('users.edit')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Set the user’s feature-restriction list (replace semantics)' })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 400, description: 'Unknown restriction key' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Account is deleted' })
  restrict(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestrictUserDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminUserDetailDto> {
    return this.service.restrict(id, dto, this.ctx(actor, ip, ua));
  }

  @Post(':id/reset-verification')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users.edit')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: "Reset one of the user's completions back to Pending (admin override)" })
  @ApiResponse({ status: 200, type: ResetVerificationResponseDto })
  @ApiResponse({ status: 404, description: 'Completion not found for this user' })
  @ApiResponse({ status: 409, description: 'Completion is already Pending' })
  resetVerification(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetVerificationDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<ResetVerificationResponseDto> {
    return this.service.resetVerification(id, dto, this.ctx(actor, ip, ua));
  }

  @Get(':id/export')
  @RequirePermission('users.export')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Export the user’s data (JSON)' })
  @ApiResponse({ status: 200, type: AdminUserExportDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  exportUser(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminUserExportDto> {
    return this.service.exportUser(id, this.ctx(actor, ip, ua));
  }

  @Delete(':id')
  @RequirePermission('users.delete')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Process an account-deletion request (soft-delete + anonymize)' })
  @ApiResponse({ status: 200, type: AdminActionResponseDto })
  @ApiResponse({ status: 400, description: 'confirm must be true' })
  @ApiResponse({ status: 404, description: 'User not found or already deleted' })
  async deleteUser(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteUserDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminActionResponseDto> {
    await this.service.deleteUser(id, dto.reason, this.ctx(actor, ip, ua));
    return { success: true };
  }

  /** Assembles the per-request audit context from the authenticated admin + request. */
  private ctx(actor: AuthAdmin, ip: string, ua?: string): AdminUserActionContext {
    return { actorAdminUserId: actor.adminUserId, ipAddress: ip, userAgent: ua ?? null };
  }
}
