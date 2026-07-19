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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { AdminChallengesService, AdminMissionActionContext } from './admin-challenges.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { ListMissionsQueryDto } from './dto/list-missions-query.dto';
import { MissionActionDto } from './dto/mission-action.dto';
import { AdminMissionDetailDto, AdminMissionPageDto } from './dto/mission-admin-response.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';

/**
 * Admin-facing authoring of the curated Mission pool (Phase 9). Gated by the new
 * RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`), NOT the legacy shared-key
 * `AdminGuard`. Thin: routing, guards, DTO binding, and Swagger only — every rule
 * (including the `status` ↔ `isActive` generator-visibility coupling) lives in
 * AdminChallengesService.
 */
@ApiTags('admin-missions')
@ApiBearerAuth()
// Every route below is behind AdminJwtAuthGuard + PermissionGuard, so 401 (no/invalid
// admin token) and 403 (missing the route's required permission) apply uniformly.
// Declared once at the class level — NestJS Swagger merges these into every operation.
@ApiUnauthorizedResponse({ description: 'Missing or invalid admin access token' })
@ApiForbiddenResponse({ description: 'Missing the required challenges.* permission' })
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/missions')
export class AdminChallengesController {
  constructor(private readonly service: AdminChallengesService) {}

  @Get()
  @RequirePermission('challenges.view')
  @ApiOperation({ summary: 'Search / filter / paginate the curated mission pool' })
  @ApiResponse({ status: 200, type: AdminMissionPageDto })
  list(@Query() query: ListMissionsQueryDto): Promise<AdminMissionPageDto> {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermission('challenges.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'View a single mission with completion/saved statistics' })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<AdminMissionDetailDto> {
    return this.service.getById(id);
  }

  @Post()
  @RequirePermission('challenges.create')
  @ApiOperation({ summary: 'Create a mission (always as Draft; authored by the caller)' })
  @ApiResponse({ status: 201, type: AdminMissionDetailDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'A mission with this title already exists' })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateMissionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.create(dto, this.ctx(actor, ip, ua));
  }

  @Patch(':id')
  @RequirePermission('challenges.edit')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a mission’s content/authoring fields' })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  @ApiResponse({ status: 409, description: 'A mission with this title already exists' })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMissionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.update(id, dto, this.ctx(actor, ip, ua));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('challenges.publish')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Publish (= approve) a mission: Published + live in the generator + approval stamp',
  })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  @ApiResponse({ status: 409, description: 'Mission is already published' })
  publish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.publish(id, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('challenges.publish')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Unpublish a mission back to Draft (drops it from the generator)' })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  @ApiResponse({ status: 409, description: 'Only a published mission can be unpublished' })
  unpublish(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.unpublish(id, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('challenges.publish')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Archive a mission (drops it from the generator, preserves history)' })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  @ApiResponse({ status: 409, description: 'Mission is already archived' })
  archive(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.archive(id, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  @Post(':id/feature')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('challenges.feature')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark a mission as featured' })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  feature(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.setFeatured(id, true, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  @Post(':id/unfeature')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('challenges.feature')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Clear a mission’s featured flag' })
  @ApiResponse({ status: 200, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  unfeature(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.setFeatured(id, false, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('challenges.create')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Duplicate a mission as a fresh Draft authored by the caller' })
  @ApiResponse({ status: 201, type: AdminMissionDetailDto })
  @ApiResponse({ status: 404, description: 'Mission not found' })
  duplicate(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AdminMissionDetailDto> {
    return this.service.duplicate(id, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('challenges.delete')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Soft-delete a mission (preserves Completion/SavedMission history)' })
  @ApiResponse({ status: 204, description: 'Deletion processed' })
  @ApiResponse({ status: 404, description: 'Mission not found or already deleted' })
  async remove(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MissionActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<void> {
    await this.service.remove(id, this.ctx(actor, ip, ua), dto.reason ?? null);
  }

  /** Assembles the per-request audit context from the authenticated admin + request. */
  private ctx(actor: AuthAdmin, ip: string, ua?: string): AdminMissionActionContext {
    return { actorAdminUserId: actor.adminUserId, ipAddress: ip, userAgent: ua ?? null };
  }
}
