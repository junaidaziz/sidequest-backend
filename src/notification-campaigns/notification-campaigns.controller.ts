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
import { Throttle } from '@nestjs/throttler';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { AuthAdmin } from '../admin-auth/types/admin-jwt-payload.interface';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { PermissionGuard } from '../rbac/guards/permission.guard';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsQueryDto } from './dto/list-campaigns-query.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import {
  CampaignDetailDto,
  CampaignPageDto,
  PreviewAudienceDto,
} from './dto/campaign-response.dto';
import { NotificationCampaignsService } from './notification-campaigns.service';
import { CampaignActionContext } from './types/campaign-targeting';

/**
 * Admin notification-campaign surface (Phase 11): CRUD, audience preview, and the
 * send/schedule/cancel lifecycle for admin-authored broadcasts.
 *
 * Gated entirely by the new RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`),
 * NOT the legacy `x-admin-key` guard. Thin: routing, guards, DTO binding, and
 * Swagger only — every rule lives in NotificationCampaignsService.
 *
 * Permission mapping: `campaigns.view` (reads + preview), `campaigns.create`
 * (create/edit/delete — there is no `campaigns.delete` key; delete is gated by the
 * same "manage" permission), `campaigns.send` (send + cancel).
 */
@ApiTags('admin-campaigns')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid admin access token' })
@ApiForbiddenResponse({ description: 'Missing the required campaigns.* permission' })
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin')
export class NotificationCampaignsController {
  constructor(private readonly service: NotificationCampaignsService) {}

  @Get('campaigns')
  @RequirePermission('campaigns.view')
  @ApiOperation({ summary: 'Search / filter / paginate notification campaigns' })
  @ApiResponse({ status: 200, type: CampaignPageDto })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  list(@Query() query: ListCampaignsQueryDto): Promise<CampaignPageDto> {
    return this.service.list(query);
  }

  @Get('campaigns/:id')
  @RequirePermission('campaigns.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'View a single campaign with real delivery + open stats' })
  @ApiResponse({ status: 200, type: CampaignDetailDto })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDetailDto> {
    return this.service.getCampaign(id);
  }

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermission('campaigns.create')
  @ApiOperation({ summary: 'Create a Draft campaign (nothing is sent until an explicit send)' })
  @ApiResponse({ status: 201, type: CampaignDetailDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  create(
    @CurrentAdmin() actor: AuthAdmin,
    @Body() dto: CreateCampaignDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CampaignDetailDto> {
    return this.service.create(dto, this.ctx(actor, ip, ua));
  }

  @Patch('campaigns/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermission('campaigns.create')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a campaign (Draft only)' })
  @ApiResponse({ status: 200, type: CampaignDetailDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  @ApiResponse({ status: 409, description: 'Campaign is no longer a Draft and cannot be edited' })
  update(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CampaignDetailDto> {
    return this.service.update(id, dto, this.ctx(actor, ip, ua));
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // No `campaigns.delete` permission exists — delete is gated by the same "manage"
  // permission as create/edit, consistent with this catalog's treatment elsewhere.
  @RequirePermission('campaigns.create')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Soft-delete a campaign (Draft only)' })
  @ApiResponse({ status: 204, description: 'Campaign soft-deleted' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  @ApiResponse({ status: 409, description: 'Campaign is no longer a Draft and cannot be deleted' })
  async remove(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<void> {
    await this.service.remove(id, this.ctx(actor, ip, ua));
  }

  @Post('campaigns/:id/preview-audience')
  @HttpCode(HttpStatus.OK)
  // Read-only — no side effects, no recipient rows created. Gated by view.
  @RequirePermission('campaigns.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Resolve the saved targetFilter to a user count (creates no rows)' })
  @ApiResponse({ status: 200, type: PreviewAudienceDto })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  previewAudience(@Param('id', ParseUUIDPipe) id: string): Promise<PreviewAudienceDto> {
    return this.service.previewAudience(id);
  }

  @Post('campaigns/:id/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('campaigns.send')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Send immediately, or schedule if scheduledAt is in the future' })
  @ApiResponse({ status: 200, type: CampaignDetailDto })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  @ApiResponse({ status: 409, description: 'Campaign is not Draft/Scheduled and cannot be sent' })
  @ApiResponse({ status: 503, description: 'Failed to enqueue the fan-out; retry' })
  send(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CampaignDetailDto> {
    return this.service.send(id, this.ctx(actor, ip, ua));
  }

  @Post('campaigns/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermission('campaigns.send')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Cancel a Scheduled or Sending campaign (best-effort for in-flight sends)',
  })
  @ApiResponse({ status: 200, type: CampaignDetailDto })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  @ApiResponse({
    status: 409,
    description: 'Campaign is not Scheduled/Sending and cannot be cancelled',
  })
  cancel(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<CampaignDetailDto> {
    return this.service.cancel(id, this.ctx(actor, ip, ua));
  }

  /** Assembles the per-request audit context from the authenticated admin + request. */
  private ctx(actor: AuthAdmin, ip: string, ua?: string): CampaignActionContext {
    return { actorAdminUserId: actor.adminUserId, ipAddress: ip, userAgent: ua ?? null };
  }
}
