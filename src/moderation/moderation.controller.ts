import {
  Body,
  Controller,
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
import { CreateModerationActionDto } from './dto/create-moderation-action.dto';
import { DecideAppealDto } from './dto/decide-appeal.dto';
import { ListAppealsQueryDto } from './dto/list-appeals-query.dto';
import { ListModerationActionsQueryDto } from './dto/list-moderation-actions-query.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import {
  AppealListItemDto,
  AppealPageDto,
  ModerationActionPageDto,
  ModerationActionSummaryDto,
  ModerationQueuePageDto,
  ProofReviewResponseDto,
  ReportDetailDto,
  ReportPageDto,
} from './dto/moderation-response.dto';
import { ModerationQueueQueryDto } from './dto/moderation-queue-query.dto';
import { ReviewProofDto } from './dto/review-proof.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ModerationService } from './moderation.service';
import { ModerationActionContext } from './types/moderation';

/**
 * Admin moderation surface (Phase 10): the unified proof/submission review queue,
 * the Report / ModerationAction / Appeal workflow, and the RBAC-gated proof-review
 * route that replaces the legacy shared-key `AdminGuard` completion route.
 *
 * Gated entirely by the new RBAC system (`AdminJwtAuthGuard` + `PermissionGuard`),
 * NOT the legacy `x-admin-key` guard. Thin: routing, guards, DTO binding, and
 * Swagger only — every rule lives in ModerationService.
 */
@ApiTags('admin-moderation')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid admin access token' })
@ApiForbiddenResponse({ description: 'Missing the required moderation.* / proofs.* permission' })
@UseGuards(AdminJwtAuthGuard, PermissionGuard)
@Controller('admin')
export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  // --- Unified queue -------------------------------------------------------

  @Get('moderation/queue')
  @RequirePermission('moderation.view_queue')
  @ApiOperation({
    summary: 'Unified, paginated queue of pending proof completions and task submissions',
  })
  @ApiResponse({ status: 200, type: ModerationQueuePageDto })
  getQueue(@Query() query: ModerationQueueQueryDto): Promise<ModerationQueuePageDto> {
    return this.service.getQueue(query);
  }

  @Get('moderation-actions')
  @RequirePermission('moderation.view_queue')
  @ApiOperation({ summary: 'Read-only moderation-action history (repeat-offender query)' })
  @ApiResponse({ status: 200, type: ModerationActionPageDto })
  listActions(@Query() query: ListModerationActionsQueryDto): Promise<ModerationActionPageDto> {
    return this.service.listActions(query);
  }

  // --- Reports -------------------------------------------------------------

  @Get('reports')
  @RequirePermission('moderation.manage_reports')
  @ApiOperation({ summary: 'Search / filter / paginate reports' })
  @ApiResponse({ status: 200, type: ReportPageDto })
  listReports(@Query() query: ListReportsQueryDto): Promise<ReportPageDto> {
    return this.service.listReports(query);
  }

  @Get('reports/:id')
  @RequirePermission('moderation.manage_reports')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'View a single report with its moderation actions' })
  @ApiResponse({ status: 200, type: ReportDetailDto })
  @ApiResponse({ status: 404, description: 'Report not found' })
  getReport(@Param('id', ParseUUIDPipe) id: string): Promise<ReportDetailDto> {
    return this.service.getReport(id);
  }

  @Patch('reports/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermission('moderation.manage_reports')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Transition a report’s status (Open → UnderReview → Resolved/Dismissed)',
  })
  @ApiResponse({ status: 200, type: ReportDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid status transition target' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @ApiResponse({ status: 409, description: 'Report is already Resolved/Dismissed' })
  updateReport(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<ReportDetailDto> {
    return this.service.updateReport(id, dto, this.ctx(actor, ip, ua));
  }

  @Post('reports/:id/actions')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermission('moderation.take_action')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Record a moderation action against the report’s target (warn/suspend/ban/remove)',
  })
  @ApiResponse({ status: 201, type: ModerationActionSummaryDto })
  @ApiResponse({ status: 400, description: 'No target user resolvable for a user-directed action' })
  @ApiResponse({ status: 403, description: 'Content action requires moderation.remove_content' })
  @ApiResponse({ status: 404, description: 'Report or target user not found' })
  @ApiResponse({ status: 409, description: 'Target account is deleted' })
  createAction(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateModerationActionDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<ModerationActionSummaryDto> {
    return this.service.createAction(id, dto, this.ctx(actor, ip, ua));
  }

  // --- Appeals -------------------------------------------------------------

  @Get('appeals')
  @RequirePermission('moderation.manage_appeals')
  @ApiOperation({ summary: 'Search / filter / paginate appeals' })
  @ApiResponse({ status: 200, type: AppealPageDto })
  listAppeals(@Query() query: ListAppealsQueryDto): Promise<AppealPageDto> {
    return this.service.listAppeals(query);
  }

  @Patch('appeals/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermission('moderation.manage_appeals')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Decide an appeal — Upheld reverses the action (un-suspends), Denied lets it stand',
  })
  @ApiResponse({ status: 200, type: AppealListItemDto })
  @ApiResponse({ status: 404, description: 'Appeal not found' })
  @ApiResponse({ status: 409, description: 'Appeal is already decided' })
  decideAppeal(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAppealDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<AppealListItemDto> {
    return this.service.decideAppeal(id, dto, this.ctx(actor, ip, ua));
  }

  // --- Proof review (RBAC replacement for the legacy x-admin-key route) -----

  @Patch('proofs/:id/verification')
  // Same tier as the legacy route it replaces — bounds abuse, well above real use.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermission('proofs.review')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Completion id.' })
  @ApiOperation({
    summary: 'Manually approve or reject a Pending completion (RBAC-gated proof review)',
  })
  @ApiResponse({ status: 200, type: ProofReviewResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid status, or missing rejectionReason on Rejected',
  })
  @ApiResponse({ status: 404, description: 'Completion not found' })
  @ApiResponse({ status: 409, description: 'Completion is no longer Pending' })
  @HttpCode(HttpStatus.OK)
  reviewProof(
    @CurrentAdmin() actor: AuthAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewProofDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ): Promise<ProofReviewResponseDto> {
    return this.service.reviewProof(id, dto, this.ctx(actor, ip, ua));
  }

  /** Assembles the per-request audit context from the authenticated admin + request. */
  private ctx(actor: AuthAdmin, ip: string, ua?: string): ModerationActionContext {
    return { actorAdminUserId: actor.adminUserId, ipAddress: ip, userAgent: ua ?? null };
  }
}
