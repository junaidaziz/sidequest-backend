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
import { AdminMissionTagsService, MissionTagActionContext } from './admin-mission-tags.service';
import { CreateMissionTagDto } from './dto/create-mission-tag.dto';
import { ListMissionTagsQueryDto } from './dto/list-mission-tags-query.dto';
import { MissionTagDto, MissionTagListDto } from './dto/mission-tag-response.dto';
import { UpdateMissionTagDto } from './dto/update-mission-tag.dto';

/**
 * Admin CRUD for the mission crew/setting tag vocabulary (closed-beta admin
 * tooling). Gated by the RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`).
 * Reads require `challenges.view`; mutations require the new `challenges.manage_tags`
 * permission. Thin: routing, guards, DTO binding, Swagger — all rules live in the
 * service.
 */
@ApiTags('admin-mission-tags')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid admin access token' })
@ApiForbiddenResponse({ description: 'Missing the required permission' })
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin/mission-tags')
export class AdminMissionTagsController {
  constructor(private readonly service: AdminMissionTagsService) {}

  @Get()
  @RequirePermission('challenges.view')
  @ApiOperation({ summary: 'List the mission tag vocabulary (active-only by default)' })
  @ApiResponse({ status: 200, type: MissionTagListDto })
  list(@Query() query: ListMissionTagsQueryDto): Promise<MissionTagListDto> {
    return this.service.list(query);
  }

  @Post()
  @RequirePermission('challenges.manage_tags')
  @ApiOperation({ summary: 'Create a mission tag' })
  @ApiResponse({ status: 201, type: MissionTagDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'A tag with this (type, value) already exists' })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateMissionTagDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<MissionTagDto> {
    return this.service.create(dto, this.ctx(actor, ip, ua));
  }

  @Patch(':id')
  @RequirePermission('challenges.manage_tags')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a mission tag (label, value, sortOrder, active state)' })
  @ApiResponse({ status: 200, type: MissionTagDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'Mission tag not found' })
  @ApiResponse({ status: 409, description: 'A tag with this (type, value) already exists' })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMissionTagDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<MissionTagDto> {
    return this.service.update(id, dto, this.ctx(actor, ip, ua));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('challenges.manage_tags')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Deactivate a mission tag (never hard-deletes — a referenced value is retired in place)',
  })
  @ApiResponse({ status: 200, type: MissionTagDto })
  @ApiResponse({ status: 404, description: 'Mission tag not found' })
  deactivate(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<MissionTagDto> {
    return this.service.deactivate(id, this.ctx(actor, ip, ua));
  }

  private ctx(actor: AuthAdmin, ip: string, ua?: string): MissionTagActionContext {
    return { actorAdminUserId: actor.adminUserId, ipAddress: ip, userAgent: ua ?? null };
  }
}
